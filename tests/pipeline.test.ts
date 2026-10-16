import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, copyFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { run, paths } from '../server/tools.js';
import { transcode, verifyOutput } from '../server/media.js';
import { JobManager } from '../server/jobs.js';
import { createApp } from '../server/app.js';
import { type VideoInfo, type ExportOptions, type Job } from '../src/shared.js';

const video: VideoInfo = {
  token: randomUUID(),
  id: 'jNQXAC9IVRw',
  url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  title: 'Pipeline fixture',
  channel: 'Tests',
  duration: 3,
  thumbnail: '',
  width: 640,
  height: 360,
};
const options: ExportOptions = {
  videoToken: video.token,
  profile: 'standard',
  quality: '720',
  aspect: 'original',
  start: 0,
  end: 2,
};

test(
  'real FFmpeg pipeline converts video and silent sources, validates results and serves downloads',
  { timeout: 120_000 },
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'postready-test-'));
    const source = path.join(directory, 'source.mkv');
    const silent = path.join(directory, 'silent.mkv');
    let manager: JobManager | undefined;
    let server:
      | ReturnType<Awaited<ReturnType<typeof createApp>>['app']['listen']>
      | undefined;
    try {
      await run(paths.ffmpeg, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=640x360:rate=24',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=44100',
        '-t',
        '3',
        '-c:v',
        'libx264',
        '-c:a',
        'pcm_s16le',
        '-y',
        source,
      ]);
      await run(paths.ffmpeg, [
        '-v',
        'error',
        '-i',
        source,
        '-map',
        '0:v:0',
        '-c',
        'copy',
        '-an',
        '-y',
        silent,
      ]);
      for (const [input, aspect] of [
        [source, 'original'],
        [source, 'portrait'],
        [silent, 'square'],
      ] as const) {
        const output = path.join(directory, `${aspect}.mp4`);
        const settings = { ...options, aspect };
        await transcode(input, output, video, settings);
        const result = await verifyOutput(output, settings);
        assert.equal(result.videoCodec, 'h264');
        assert.equal(result.audioCodec, 'aac');
        assert.equal(result.fps, 30);
        assert.ok(Math.abs(result.duration - 2) < 0.1);
        assert.equal(result.checks.length, 7);
        if (aspect === 'portrait')
          assert.deepEqual([result.width, result.height], [720, 1280]);
        if (aspect === 'square')
          assert.deepEqual([result.width, result.height], [720, 720]);
      }
      await assert.rejects(
        verifyOutput(path.join(directory, 'original.mp4'), {
          ...options,
          end: 20,
        }),
        /complete selected clip/,
      );
      await assert.rejects(verifyOutput(source, options), /MP4 container/);
      manager = new JobManager(path.join(directory, '.data'), {
        async downloadClip(_video, _options, target, signal) {
          signal.throwIfAborted();
          const file = path.join(target, 'source.mkv');
          await copyFile(source, file);
          return file;
        },
        transcode,
        verifyOutput,
      });
      const { app } = await createApp(manager, async () => video);
      server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const base = `http://127.0.0.1:${address.port}`;
      const post = (
        route: string,
        body: unknown,
        headers?: Record<string, string>,
      ) =>
        fetch(`${base}${route}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
        });
      assert.equal(
        (await post('/api/inspect', { url: 'http://127.0.0.1/private' }))
          .status,
        400,
      );
      assert.equal(
        (
          await post(
            '/api/inspect',
            { url: video.url },
            { Origin: 'https://evil.test' },
          )
        ).status,
        403,
      );
      const foreignHostStatus = await new Promise<number | undefined>(
        (resolve, reject) => {
          const req = request(
            `${base}/api/jobs`,
            { headers: { Host: 'evil.test' } },
            (response) => {
              response.resume();
              resolve(response.statusCode);
            },
          );
          req.on('error', reject);
          req.end();
        },
      );
      assert.equal(foreignHostStatus, 403);
      assert.equal(
        (await post('/api/jobs', { ...options, videoToken: randomUUID() }))
          .status,
        410,
      );
      assert.equal(
        (await post('/api/inspect', { url: video.url })).status,
        200,
      );
      assert.equal(
        (await post('/api/jobs', { ...options, end: 4 })).status,
        400,
      );
      const response = await post('/api/jobs', options);
      assert.equal(response.status, 202);
      const created: Job = await response.json();
      let finished: Job = created;
      for (let i = 0; i < 200; i++) {
        finished = await (await fetch(`${base}/api/jobs/${created.id}`)).json();
        if (['completed', 'failed'].includes(finished.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(finished.status, 'completed', finished.error);
      assert.equal(finished.progress, 100);
      const file = await fetch(`${base}/api/jobs/${created.id}/file`);
      assert.equal(file.status, 200);
      assert.match(file.headers.get('content-disposition')!, /attachment/);
      assert.equal(file.headers.get('content-type'), 'video/mp4');
      assert.equal(
        (await file.arrayBuffer()).byteLength,
        finished.result!.size,
      );
      const range = await fetch(
        `${base}/api/jobs/${created.id}/file?preview=1`,
        { headers: { Range: 'bytes=0-1023' } },
      );
      assert.equal(range.status, 206);
      assert.equal((await range.arrayBuffer()).byteLength, 1024);
      const restored = new JobManager(path.join(directory, '.data'));
      await restored.init();
      assert.equal(restored.jobs.get(created.id)?.status, 'completed');
      assert.equal(
        (
          await readFile(
            path.join(directory, '.data', created.id, 'job.json'),
            'utf8',
          )
        ).includes('completed'),
        true,
      );
      assert.equal(
        (await fetch(`${base}/api/jobs/${created.id}`, { method: 'DELETE' }))
          .status,
        200,
      );
      assert.equal(
        (await fetch(`${base}/api/jobs/${created.id}/file`)).status,
        404,
      );
    } finally {
      manager?.shutdown();
      if (server)
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'cancels processing and removes partial files without completing a cancelled export',
  { timeout: 15_000 },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'postready-cancel-'),
    );
    const manager = new JobManager(directory, {
      async downloadClip(_video, _options, _directory, signal) {
        return new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('Export cancelled.')),
            { once: true },
          );
          if (signal.aborted) reject(new Error('Export cancelled.'));
        });
      },
      transcode,
      verifyOutput,
    });
    try {
      await manager.init();
      const job = await manager.create(video, options);
      assert.equal(await manager.cancel(job.id), true);
      for (let i = 0; i < 100; i++) {
        try {
          await manager.remove(job.id);
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      assert.equal(manager.jobs.has(job.id), false);
    } finally {
      manager.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'terminates a subprocess when cancellation is requested',
  { timeout: 10_000 },
  async () => {
    const controller = new AbortController();
    const promise = run(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(promise, /cancelled/);
  },
);
