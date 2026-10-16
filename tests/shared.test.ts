import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalYouTubeUrl,
  parseTime,
  formatTime,
  validateClip,
  exportSchema,
  type VideoInfo,
  type ExportOptions,
} from '../src/shared.js';
import { outputDimensions } from '../server/media.js';

const video: VideoInfo = {
  token: 'f8c37cc6-0bf9-4c75-9eca-7071ba64587c',
  id: 'jNQXAC9IVRw',
  url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  title: 'Test',
  channel: 'Test',
  duration: 600,
  thumbnail: '',
  width: 1920,
  height: 1080,
};
const options: ExportOptions = {
  videoToken: video.token,
  profile: 'standard',
  quality: '720',
  aspect: 'original',
  start: 0,
  end: 140,
};

test('normalizes watch, Shorts, share, embed and live links without preserving injected parameters', () => {
  for (const link of [
    'https://youtu.be/jNQXAC9IVRw?t=10',
    'https://www.youtube.com/watch?v=jNQXAC9IVRw&list=playlist',
    'https://m.youtube.com/shorts/jNQXAC9IVRw',
    'https://youtube.com/embed/jNQXAC9IVRw',
    'https://youtube.com/live/jNQXAC9IVRw',
  ])
    assert.equal(canonicalYouTubeUrl(link), video.url);
});

test('rejects arbitrary hosts, credentials, ports and invalid IDs', () => {
  for (const link of [
    'file:///etc/passwd',
    'https://youtube.com.evil.test/watch?v=jNQXAC9IVRw',
    'https://youtube.com@127.0.0.1/watch?v=jNQXAC9IVRw',
    'http://localhost/',
    'https://youtube.com:8080/watch?v=jNQXAC9IVRw',
    'https://youtube.com/watch?v=--exec',
    'https://youtu.be/',
    'https://youtube.com/playlist?list=foo',
  ])
    assert.throws(() => canonicalYouTubeUrl(link));
});

test('parses timestamps and rejects ambiguous or invalid values', () => {
  assert.equal(parseTime('1:30'), 90);
  assert.equal(parseTime('1:02:03'), 3723);
  assert.equal(parseTime('90'), 90);
  assert.equal(formatTime(3723), '1:02:03');
  for (const value of ['', '-1', '1:90', '1::00', 'abc', '1:2:3:4'])
    assert.ok(Number.isNaN(parseTime(value)), value);
});

test('enforces preset duration and source bounds on the server', () => {
  assert.equal(validateClip(options, video), null);
  assert.match(validateClip({ ...options, end: 141 }, video)!, /preset allows/);
  assert.match(
    validateClip({ ...options, start: 99, end: 99 }, video)!,
    /at least/,
  );
  assert.match(
    validateClip({ ...options, start: 590, end: 610 }, video)!,
    /within the source/,
  );
  assert.equal(
    validateClip({ ...options, profile: 'premium', end: 600 }, video),
    null,
  );
  assert.equal(
    exportSchema.safeParse({ ...options, start: Infinity }).success,
    false,
  );
  assert.equal(
    exportSchema.safeParse({ ...options, aspect: 'shell-command' }).success,
    false,
  );
});

test('fits landscape, vertical, square and extreme aspect ratios into bounded even dimensions', () => {
  assert.deepEqual(outputDimensions(video, options), {
    width: 1280,
    height: 720,
  });
  assert.deepEqual(outputDimensions({ width: 1080, height: 1920 }, options), {
    width: 720,
    height: 1280,
  });
  assert.deepEqual(outputDimensions(video, { ...options, aspect: 'square' }), {
    width: 720,
    height: 720,
  });
  assert.deepEqual(
    outputDimensions(video, { ...options, aspect: 'portrait' }),
    { width: 720, height: 1280 },
  );
  const extreme = outputDimensions({ width: 3000, height: 200 }, options);
  assert.ok(extreme.width / extreme.height <= 3);
  assert.equal(extreme.width % 2, 0);
  assert.equal(extreme.height % 2, 0);
  const longPremium = outputDimensions(video, {
    ...options,
    quality: '1080',
    profile: 'premium',
    end: 8000,
  });
  assert.deepEqual(longPremium, { width: 1280, height: 720 });
});
