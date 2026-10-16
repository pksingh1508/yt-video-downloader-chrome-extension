import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { type VideoInfo, type ExportOptions } from '../src/shared.js';
import { paths, run, downloaderArgs } from './tools.js';

export async function inspectVideo(url: string): Promise<VideoInfo> {
  const output = await run(paths.downloader, [
    ...downloaderArgs(),
    '--dump-single-json',
    '--skip-download',
    '--no-warnings',
    '--',
    url,
  ]);
  const data = JSON.parse(output);
  if (data.is_live || data.is_upcoming || data.live_status === 'is_live')
    throw new Error(
      'Live and upcoming videos aren’t supported. Use a finished video.',
    );
  if (!Number.isFinite(data.duration) || data.duration <= 0)
    throw new Error(
      'This video has no available duration. Try a finished video.',
    );
  if (data.duration > 24 * 3600)
    throw new Error('Source videos longer than 24 hours aren’t supported.');
  return {
    token: randomUUID(),
    id: data.id,
    url,
    title: String(data.title || 'YouTube video').slice(0, 500),
    channel: String(data.channel || data.uploader || 'YouTube').slice(0, 200),
    duration: data.duration,
    thumbnail: `https://i.ytimg.com/vi/${data.id}/hqdefault.jpg`,
    width: data.width || 1280,
    height: data.height || 720,
  };
}

export async function downloadClip(
  video: VideoInfo,
  options: ExportOptions,
  directory: string,
  signal: AbortSignal,
  onProgress: (value: number) => void,
): Promise<string> {
  const quality =
    options.profile === 'premium' && options.end - options.start > 7200
      ? '720'
      : options.quality;
  const maxEdge = quality === '1080' ? 1920 : 1280;
  const args = [
    ...downloaderArgs(),
    '--ffmpeg-location',
    path.dirname(paths.ffmpeg),
    '-f',
    `bv*[height<=${maxEdge}][width<=${maxEdge}]+ba/b[height<=${maxEdge}][width<=${maxEdge}]/b`,
    '--download-sections',
    `*${options.start}-${options.end}`,
    '--force-keyframes-at-cuts',
    '--merge-output-format',
    'mkv',
    '--max-filesize',
    '16G',
    '--newline',
    '--progress-template',
    'download:postready:%(progress._percent_str)s',
    '-o',
    path.join(directory, 'source.%(ext)s'),
    '--',
    video.url,
  ];
  await run(paths.downloader, args, {
    signal,
    timeoutMs: 4 * 60 * 60 * 1000,
    onLine(line) {
      const match = line.match(/postready:\s*([\d.]+)%/);
      if (match) onProgress(Number(match[1]));
    },
  });
  const files = (await readdir(directory)).filter((name) =>
    /^source\.(mp4|mkv|webm|mov)$/.test(name),
  );
  if (!files.length)
    throw new Error(
      'The downloader returned no usable video. Try another source.',
    );
  return path.join(directory, files[0]);
}
