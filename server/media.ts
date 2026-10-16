import { stat } from 'node:fs/promises';
import {
  PROFILES,
  type ExportOptions,
  type VideoInfo,
  type Verification,
} from '../src/shared.js';
import { paths, run } from './tools.js';

type Stream = {
  codec_type: string;
  codec_name: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  avg_frame_rate?: string;
  sample_aspect_ratio?: string;
  field_order?: string;
  channels?: number;
};
export type Probe = {
  streams: Stream[];
  format: { duration: string; size: string; format_name: string };
};

export async function probe(
  file: string,
  signal?: AbortSignal,
): Promise<Probe> {
  return JSON.parse(
    await run(
      paths.ffprobe,
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
      { signal },
    ),
  );
}

export function outputDimensions(
  video: Pick<VideoInfo, 'width' | 'height'>,
  options: Pick<
    ExportOptions,
    'aspect' | 'quality' | 'profile' | 'start' | 'end'
  >,
) {
  const quality =
    options.profile === 'premium' && options.end - options.start > 7200
      ? 720
      : Number(options.quality);
  const longEdge = quality === 1080 ? 1920 : 1280;
  if (options.aspect === 'landscape')
    return { width: longEdge, height: quality };
  if (options.aspect === 'portrait')
    return { width: quality, height: longEdge };
  if (options.aspect === 'square') return { width: quality, height: quality };
  const sourceW = video.width || 1280;
  const sourceH = video.height || 720;
  // Preserve content with padding if an unusual source exceeds X's 1:3–3:1 range.
  const ratio = Math.max(1 / 3, Math.min(3, sourceW / sourceH));
  const targetW = ratio >= 1 ? Math.min(longEdge, quality * ratio) : quality;
  const targetH = targetW / ratio;
  const factor = Math.min(
    1,
    longEdge / targetH,
    Math.max(sourceW / targetW, sourceH / targetH),
  );
  let width = Math.max(32, Math.floor((targetW * factor) / 2) * 2);
  let height = Math.max(32, Math.floor((targetH * factor) / 2) * 2);
  // Rounding must never move a boundary ratio outside the allowed range.
  if (width / height > 3) width = height * 3;
  if (width / height < 1 / 3) height = width * 3;
  return { width, height };
}

export async function transcode(
  source: string,
  destination: string,
  video: VideoInfo,
  options: ExportOptions,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
) {
  const info = await probe(source, signal);
  const sourceVideo = info.streams.find(
    (stream) => stream.codec_type === 'video',
  );
  if (!sourceVideo) throw new Error('The source has no video stream.');
  const { width, height } = outputDimensions(
    {
      width: sourceVideo.width || video.width,
      height: sourceVideo.height || video.height,
    },
    options,
  );
  const duration = options.end - options.start;
  const hasAudio = info.streams.some((stream) => stream.codec_type === 'audio');
  // Reserve space for AAC and container overhead; VBV bounds peaks as well as average rate.
  const maxKbps = Math.floor(
    (PROFILES[options.profile].maxBytes * 0.9 * 8) / duration / 1000 - 160,
  );
  const bitrate = Math.min(options.quality === '1080' ? 8000 : 5000, maxKbps);
  const filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', source];
  if (!hasAudio)
    args.push(
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
    );
  args.push(
    '-map',
    '0:v:0',
    '-map',
    hasAudio ? '0:a:0' : '1:a:0',
    '-t',
    String(duration),
    '-vf',
    filter,
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '21',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-maxrate',
    `${bitrate}k`,
    '-bufsize',
    `${bitrate * 2}k`,
    '-g',
    '60',
    '-flags',
    '+cgop',
    '-x264-params',
    'open-gop=0',
    '-c:a',
    'aac',
    '-profile:a',
    'aac_low',
    '-b:a',
    '128k',
    '-ac',
    '2',
    '-ar',
    '48000',
    '-map_metadata',
    '-1',
    '-movflags',
    '+faststart',
    '-shortest',
    '-progress',
    'pipe:1',
    '-nostats',
    destination,
  );
  await run(paths.ffmpeg, args, {
    signal,
    timeoutMs: 4 * 60 * 60 * 1000,
    onLine(line) {
      if (line.startsWith('out_time_us='))
        onProgress?.(
          Math.min(
            99,
            (Number(line.split('=')[1]) / 1_000_000 / duration) * 100,
          ),
        );
    },
  });
}

export async function verifyOutput(
  file: string,
  options: ExportOptions,
  signal?: AbortSignal,
): Promise<Verification> {
  const info = await probe(file, signal);
  const video = info.streams.find((stream) => stream.codec_type === 'video');
  const audio = info.streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number(info.format.duration);
  const size = (await stat(file)).size;
  const [numerator, denominator] = (video?.avg_frame_rate || '0/1')
    .split('/')
    .map(Number);
  const fps = numerator / denominator;
  const width = video?.width || 0,
    height = video?.height || 0;
  const expected = options.end - options.start;
  const profile = PROFILES[options.profile];
  const maxEdge =
    options.profile === 'premium' && expected > 7200
      ? 1280
      : options.quality === '1080'
        ? 1920
        : 1280;
  const fail = (message: string) => {
    throw new Error(`Output verification failed: ${message}`);
  };
  if (!info.format.format_name.includes('mp4'))
    fail('expected an MP4 container.');
  if (video?.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p')
    fail('expected H.264 video with YUV 4:2:0.');
  if (
    video?.field_order &&
    !['progressive', 'unknown'].includes(video.field_order)
  )
    fail('video must be progressive.');
  if (video?.sample_aspect_ratio && video.sample_aspect_ratio !== '1:1')
    fail('pixels must be square.');
  if (
    audio?.codec_name !== 'aac' ||
    audio.profile !== 'LC' ||
    !audio.channels ||
    audio.channels > 2
  )
    fail('expected mono or stereo AAC-LC audio.');
  if (
    !Number.isFinite(duration) ||
    duration < 0.5 ||
    duration > profile.maxDuration + 0.05
  )
    fail('duration exceeds this preset’s limit.');
  if (Math.abs(duration - expected) > 1)
    fail('the download did not contain the complete selected clip.');
  if (size > profile.maxBytes)
    fail('file size exceeds the upload limit. Choose 720p or a shorter clip.');
  if (!Number.isFinite(fps) || fps <= 0 || fps > 60)
    fail('frame rate must be at most 60 fps.');
  if (
    width < 32 ||
    height < 32 ||
    width % 2 ||
    height % 2 ||
    width / height > 3 ||
    width / height < 1 / 3 ||
    Math.max(width, height) > maxEdge
  )
    fail('dimensions exceed the selected preset.');
  // Decode the complete result to catch corruption that a metadata-only probe can miss.
  await run(
    paths.ffmpeg,
    [
      '-v',
      'error',
      '-xerror',
      '-i',
      file,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      '-f',
      'null',
      '-',
    ],
    { signal, timeoutMs: 4 * 60 * 60 * 1000, maxOutput: 100_000 },
  );
  return {
    duration,
    size,
    width,
    height,
    fps,
    videoCodec: video!.codec_name,
    audioCodec: audio!.codec_name,
    checks: [
      'MP4 container',
      'H.264 · YUV 4:2:0',
      'AAC-LC stereo',
      'Duration within limit',
      'File size within limit',
      'Dimensions & frame rate',
      'Full playback integrity',
    ],
  };
}
