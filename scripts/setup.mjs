import { mkdir, chmod, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

const platform = process.platform;
const asset =
  platform === 'darwin'
    ? 'yt-dlp_macos'
    : platform === 'win32'
      ? 'yt-dlp.exe'
      : process.arch === 'arm64'
        ? 'yt-dlp_linux_aarch64'
        : 'yt-dlp_linux';
if (
  !['darwin', 'win32', 'linux'].includes(platform) ||
  (platform === 'linux' && !['x64', 'arm64'].includes(process.arch))
) {
  throw new Error(
    'Set YTDLP_PATH to a system-installed yt-dlp on this platform.',
  );
}
const directory = path.resolve('.tools');
const destination = path.join(
  directory,
  platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
);
await mkdir(directory, { recursive: true });
const releaseResponse = await fetch(
  'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
  { headers: { 'User-Agent': 'PostReady-setup' } },
);
if (!releaseResponse.ok)
  throw new Error(`Could not find yt-dlp release: ${releaseResponse.status}`);
const release = await releaseResponse.json();
const binary = release.assets.find((item) => item.name === asset);
const sums = release.assets.find((item) => item.name === 'SHA2-256SUMS');
if (!binary || !sums)
  throw new Error(
    'The official release is missing the binary or checksum manifest.',
  );
console.log(`Downloading official yt-dlp ${release.tag_name} (${asset})…`);
const response = await fetch(binary.browser_download_url);
if (!response.ok || !response.body)
  throw new Error(`Download failed: ${response.status}`);
const temp = `${destination}.download`;
try {
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temp));
  const checksumsResponse = await fetch(sums.browser_download_url);
  if (!checksumsResponse.ok)
    throw new Error('Could not fetch release checksums.');
  const checksums = await checksumsResponse.text();
  const expected = checksums
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1]?.replace(/^\*/, '') === asset)?.[0];
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(temp)) hash.update(chunk);
  if (!expected || hash.digest('hex') !== expected)
    throw new Error('Checksum verification failed.');
  await chmod(temp, 0o755);
  await rename(temp, destination);
  console.log(
    'Verified and installed yt-dlp. FFmpeg and FFprobe are provided by npm dependencies.',
  );
  console.log('Ready. Run npm run build, load dist in Chrome, and run npm start.');
} finally {
  await rm(temp, { force: true });
}
