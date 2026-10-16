import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

export const paths = {
  downloader:
    process.env.YTDLP_PATH ||
    path.resolve(
      '.tools',
      process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
    ),
  ffmpeg: process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg',
  ffprobe: process.env.FFPROBE_PATH || ffprobeStatic.path,
};

type RunOptions = {
  signal?: AbortSignal;
  onLine?: (line: string) => void;
  timeoutMs?: number;
  maxOutput?: number;
};

export async function run(
  binary: string,
  args: string[],
  options: RunOptions = {},
): Promise<string> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    let output = '',
      errorOutput = '',
      pending = '',
      settled = false;
    let failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (force = false) => {
      if (!child.pid) return;
      try {
        if (process.platform !== 'win32')
          process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
        else child.kill(force ? 'SIGKILL' : 'SIGTERM');
      } catch {
        /* Process already exited. */
      }
    };
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      kill();
      killTimer = setTimeout(() => kill(true), 2000);
      killTimer.unref();
    };
    const aborted = () => stop(new Error('Export cancelled.'));
    options.signal?.addEventListener('abort', aborted, { once: true });
    const timer = setTimeout(
      () => stop(new Error('Processing timed out. Try a shorter clip.')),
      options.timeoutMs ?? 120_000,
    );
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', aborted);
      if (pending) options.onLine?.(pending);
      error ? reject(error) : resolve(output);
    };
    const consume = (data: Buffer, isError: boolean) => {
      const chunk = data.toString();
      if (isError) errorOutput = (errorOutput + chunk).slice(-12_000);
      else {
        output += chunk;
        if (output.length > (options.maxOutput ?? 8_000_000))
          stop(
            new Error('The video response was too large. Try another video.'),
          );
      }
      pending += chunk;
      const lines = pending.split(/[\r\n]+/);
      pending = lines.pop() || '';
      for (const line of lines) options.onLine?.(line);
    };
    child.stdout.on('data', (data) => consume(data, false));
    child.stderr.on('data', (data) => consume(data, true));
    child.once('error', (error) =>
      finish(
        new Error(`Could not start ${path.basename(binary)}: ${error.message}`),
      ),
    );
    child.once('close', (code) =>
      finish(
        failure ||
          (code !== 0
            ? new Error(
                errorOutput || `${path.basename(binary)} exited with ${code}`,
              )
            : undefined),
      ),
    );
    if (options.signal?.aborted) aborted();
  });
}

export async function toolHealth() {
  const entries = await Promise.all(
    Object.entries(paths).map(async ([key, binary]) => {
      try {
        if (path.isAbsolute(binary) && !existsSync(binary))
          return [key, false] as const;
        await run(binary, [key === 'downloader' ? '--version' : '-version'], {
          timeoutMs: 60_000,
        });
        return [key, true] as const;
      } catch {
        return [key, false] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as {
    downloader: boolean;
    ffmpeg: boolean;
    ffprobe: boolean;
  };
}

export function downloaderArgs(): string[] {
  const args = [
    '--ignore-config',
    '--no-plugin-dirs',
    '--no-playlist',
    '--js-runtimes',
    `node:${process.execPath}`,
    '--remote-components',
    'ejs:github',
    '--socket-timeout',
    '30',
    '--retries',
    '3',
    '--extractor-retries',
    '2',
  ];
  if (process.env.YTDLP_COOKIES_FILE)
    args.push('--cookies', process.env.YTDLP_COOKIES_FILE);
  return args;
}

export function friendlyError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  if (/cancelled/i.test(value)) return 'Export cancelled.';
  if (/sign in|bot|cookies|confirm you.re not/i.test(value))
    return 'YouTube is asking for sign-in or bot verification. Try another video, or configure your own cookies file as described in the README.';
  if (/private|members.only|login required|age.restricted/i.test(value))
    return 'This video requires access or sign-in. Try a publicly available video.';
  if (/unavailable|copyright|removed|not available/i.test(value))
    return 'This video is unavailable or restricted in your region. Try another link.';
  if (/ENOENT|Could not start/i.test(value))
    return 'A processing tool is missing. Run npm run setup, then restart the server.';
  if (/timed out|timeout|network|connection|HTTP Error|429|403/i.test(value))
    return 'YouTube could not be reached or blocked the download. Try again later or use another video.';
  if (/disk|ENOSPC|space left/i.test(value))
    return 'There isn’t enough free disk space for this video. Free some space and try again.';
  if (
    /verification|clip|too large|audio|dimension|duration|too short|aborted|live|length|format|exceed/i.test(
      value,
    ) &&
    value.length < 350
  )
    return value;
  return 'The video could not be processed. Try another video or a shorter clip. See the server log for details.';
}
