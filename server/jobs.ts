import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import {
  type ExportOptions,
  type VideoInfo,
  type Job,
  isActive,
} from '../src/shared.js';
import { downloadClip } from './downloader.js';
import { transcode, verifyOutput } from './media.js';
import { friendlyError } from './tools.js';

export class JobManager {
  readonly jobs = new Map<string, Job>();
  private controllers = new Map<string, AbortController>();
  private running = 0;
  private persistence = new Map<string, Promise<void>>();
  constructor(
    readonly directory = path.resolve(process.env.DATA_DIR || '.data'),
    private readonly dependencies = { downloadClip, transcode, verifyOutput },
  ) {}

  async init() {
    await mkdir(this.directory, { recursive: true });
    for (const id of await readdir(this.directory)) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue;
      try {
        const job: Job = JSON.parse(
          await readFile(path.join(this.directory, id, 'job.json'), 'utf8'),
        );
        if (job.id !== id) continue;
        if (Date.now() - Date.parse(job.createdAt) > 24 * 60 * 60 * 1000) {
          await rm(this.jobDirectory(id), { recursive: true, force: true });
          continue;
        }
        if (isActive(job)) {
          job.status = 'failed';
          job.error =
            'The server restarted during this export. Please try again.';
          job.message = job.error;
        }
        this.jobs.set(id, job);
        await this.save(job);
        await this.cleanSource(id);
      } catch (error) {
        console.warn(
          `Could not restore export ${id}:`,
          error instanceof Error ? error.message : 'Invalid manifest',
        );
      }
    }
  }

  list() {
    return [...this.jobs.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }
  activeCount() {
    return this.list().filter(isActive).length;
  }
  jobDirectory(id: string) {
    return path.join(this.directory, id);
  }
  outputPath(id: string) {
    return path.join(this.jobDirectory(id), 'output.mp4');
  }

  private save(job: Job) {
    const json = JSON.stringify(job, null, 2);
    const previous = this.persistence.get(job.id) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        await mkdir(this.jobDirectory(job.id), { recursive: true });
        const target = path.join(this.jobDirectory(job.id), 'job.json');
        await writeFile(`${target}.tmp`, json);
        await rename(`${target}.tmp`, target);
      });
    this.persistence.set(job.id, next);
    return next;
  }

  async create(video: VideoInfo, options: ExportOptions): Promise<Job> {
    if (this.activeCount() >= 10)
      throw new Error('The export queue is full. Wait for a job to finish.');
    const job: Job = {
      id: randomUUID(),
      video,
      options,
      createdAt: new Date().toISOString(),
      status: 'queued',
      progress: 0,
      message: 'Waiting for a processing slot…',
    };
    this.jobs.set(job.id, job);
    try {
      await this.save(job);
    } catch (error) {
      this.jobs.delete(job.id);
      throw error;
    }
    this.pump();
    return job;
  }

  private pump() {
    while (this.running < 2) {
      const job = [...this.jobs.values()].find(
        (job) => job.status === 'queued',
      );
      if (!job) break;
      this.running++;
      job.status = 'downloading';
      void this.execute(job)
        .catch((error) =>
          console.error('Export finalization failed:', error.message),
        )
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }

  private async execute(job: Job) {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    let lastSave = 0;
    const update = (
      status: Job['status'],
      progress: number,
      message: string,
    ) => {
      if (controller.signal.aborted) return;
      const stageChanged = job.status !== status;
      Object.assign(job, {
        status,
        progress: Math.max(job.progress, Math.round(progress)),
        message,
      });
      if (stageChanged || Date.now() - lastSave > 1000) {
        lastSave = Date.now();
        void this.save(job).catch((error) =>
          console.error('Could not save export progress:', error.message),
        );
      }
    };
    try {
      update('downloading', 5, 'Downloading your selected clip from YouTube…');
      const source = await this.dependencies.downloadClip(
        job.video,
        job.options,
        this.jobDirectory(job.id),
        controller.signal,
        (progress) =>
          update(
            'downloading',
            5 + progress * 0.35,
            'Downloading your selected clip from YouTube…',
          ),
      );
      controller.signal.throwIfAborted();
      update(
        'converting',
        42,
        'Encoding an MP4 with H.264 video and AAC audio…',
      );
      await this.dependencies.transcode(
        source,
        this.outputPath(job.id),
        job.video,
        job.options,
        controller.signal,
        (progress) =>
          update(
            'converting',
            42 + progress * 0.48,
            'Encoding an MP4 with H.264 video and AAC audio…',
          ),
      );
      update('verifying', 93, 'Checking upload limits and verifying playback…');
      const result = await this.dependencies.verifyOutput(
        this.outputPath(job.id),
        job.options,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      job.result = result;
      job.filename = `${
        job.video.title
          .replace(/[^\p{L}\p{N} _-]/gu, '')
          .slice(0, 90)
          .trim() || 'video'
      }-x-ready.mp4`;
      update(
        'completed',
        100,
        'All checks passed. Your video is ready to download.',
      );
    } catch (error) {
      job.status = controller.signal.aborted ? 'cancelled' : 'failed';
      job.error =
        job.status === 'cancelled' ? 'Export cancelled.' : friendlyError(error);
      job.message = job.error;
      // The raw downloader error can contain signed URLs; only show the sanitized error.
      console.error(`Export ${job.id}: ${job.error}`);
      await rm(this.outputPath(job.id), { force: true }).catch(() => {});
    } finally {
      try {
        await this.cleanSource(job.id);
        await this.save(job).catch((error) =>
          console.error('Could not save export:', error.message),
        );
      } finally {
        this.controllers.delete(job.id);
      }
    }
  }

  private async cleanSource(id: string) {
    const files = await readdir(this.jobDirectory(id)).catch(
      () => [] as string[],
    );
    await Promise.all(
      files
        .filter((file) => file.startsWith('source.'))
        .map((file) =>
          rm(path.join(this.jobDirectory(id), file), { force: true }),
        ),
    );
  }

  async cancel(id: string) {
    const job = this.jobs.get(id);
    if (!job || !isActive(job)) return false;
    job.status = 'cancelled';
    job.message = 'Export cancelled.';
    this.controllers.get(id)?.abort();
    await this.save(job);
    return true;
  }

  async remove(id: string) {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (isActive(job) || this.controllers.has(id))
      throw new Error(
        'Cancel this export and wait for processing to stop before deleting it.',
      );
    await this.persistence.get(id)?.catch(() => {});
    await rm(this.jobDirectory(id), { recursive: true, force: true });
    this.jobs.delete(id);
    this.persistence.delete(id);
    return true;
  }

  async cleanup() {
    for (const job of this.jobs.values())
      if (
        !isActive(job) &&
        !this.controllers.has(job.id) &&
        Date.now() - Date.parse(job.createdAt) > 24 * 60 * 60 * 1000
      )
        await this.remove(job.id);
  }

  shutdown() {
    for (const controller of this.controllers.values()) controller.abort();
  }
}
