// Only the YouTube network boundary is replaced; conversion, verification, API,
// persistence, and file serving all use production code.
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { createApp } from '../../server/app.js';
import { JobManager } from '../../server/jobs.js';
import { transcode, verifyOutput } from '../../server/media.js';
import { run, paths } from '../../server/tools.js';

const directory = await mkdtemp(path.join(tmpdir(), 'postready-e2e-'));
const source = path.join(directory, 'fixture.mkv');
await run(paths.ffmpeg, [
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=320x240:rate=24',
  '-t',
  '4',
  '-c:v',
  'libx264',
  '-y',
  source,
]);
const manager = new JobManager(path.join(directory, '.data'), {
  async downloadClip(_video, _options, target, signal) {
    await setTimeout(1800, undefined, { signal });
    const file = path.join(target, 'source.mkv');
    await copyFile(source, file);
    return file;
  },
  transcode,
  verifyOutput,
});
const { app } = await createApp(manager, async (url) => ({
  token: randomUUID(),
  id: new URL(url).searchParams.get('v')!,
  url,
  title: 'Extension test fixture',
  channel: 'Local test video',
  duration: 4,
  thumbnail: '',
  width: 320,
  height: 240,
}));
const server = app.listen(3002, '127.0.0.1');
async function shutdown() {
  manager.shutdown();
  server.close();
  server.closeAllConnections();
  await rm(directory, { force: true, recursive: true });
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
