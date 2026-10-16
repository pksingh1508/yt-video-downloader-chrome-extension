import { z } from 'zod';

export const PROFILES = {
  standard: {
    label: 'X Standard',
    maxDuration: 140,
    maxBytes: 512_000_000,
    description: 'Works with every X account',
  },
  premium: {
    label: 'X Premium · web',
    maxDuration: 14_399,
    maxBytes: 16_000_000_000,
    description: 'Requires Premium on x.com or iOS',
  },
} as const;

export const exportSchema = z.object({
  videoToken: z.string().uuid(),
  profile: z.enum(['standard', 'premium']),
  quality: z.enum(['720', '1080']),
  aspect: z.enum(['original', 'landscape', 'square', 'portrait']),
  start: z.number().finite().nonnegative(),
  end: z.number().finite().positive(),
});

export type ExportOptions = z.infer<typeof exportSchema>;
export type VideoInfo = {
  token: string;
  id: string;
  url: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  width: number;
  height: number;
};
export type Verification = {
  duration: number;
  size: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
  fps: number;
  checks: string[];
};
export type Job = {
  id: string;
  video: VideoInfo;
  options: ExportOptions;
  createdAt: string;
  status:
    | 'queued'
    | 'downloading'
    | 'converting'
    | 'verifying'
    | 'completed'
    | 'failed'
    | 'cancelled';
  progress: number;
  message: string;
  error?: string;
  result?: Verification;
  filename?: string;
};
export type Health = {
  ready: boolean;
  tools: { downloader: boolean; ffmpeg: boolean; ffprobe: boolean };
  activeJobs: number;
};

export function canonicalYouTubeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Enter a complete YouTube link, including https://.');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error('Please use a public YouTube video link.');
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (
    [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
    ].includes(host)
  ) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (/^\/(shorts|embed|live)\//.test(url.pathname))
      id = url.pathname.split('/')[2];
  }
  if (!id || !/^[\w-]{11}$/.test(id))
    throw new Error(
      'That doesn’t look like a YouTube video link. Try a watch, Shorts, or youtu.be link.',
    );
  return `https://www.youtube.com/watch?v=${id}`;
}

export function validateClip(
  options: ExportOptions,
  video: VideoInfo,
): string | null {
  const duration = options.end - options.start;
  if (duration < 1) return 'Choose a clip at least 1 second long.';
  if (options.start >= video.duration || options.end > video.duration + 0.01)
    return 'Your clip must be within the source video.';
  if (duration > PROFILES[options.profile].maxDuration)
    return `This preset allows up to ${formatTime(PROFILES[options.profile].maxDuration)}. Shorten your clip or choose Premium.`;
  return null;
}

export function formatTime(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function parseTime(value: string): number {
  const parts = value.trim().split(':');
  if (
    !parts.length ||
    parts.length > 3 ||
    parts.some((p) => !/^\d+(\.\d+)?$/.test(p))
  )
    return NaN;
  if (parts.length > 1 && parts.slice(1).some((p) => Number(p) >= 60))
    return NaN;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

export function formatBytes(bytes: number): string {
  return bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toFixed(1)} GB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export const isActive = (job: Job) =>
  ['queued', 'downloading', 'converting', 'verifying'].includes(job.status);
