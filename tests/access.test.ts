import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { request } from 'node:http';
import { localAccess } from '../server/access.js';
import { EXTENSION_ID } from '../src/config.js';

test('companion permits only the known extension and local development origins, including preflight', async () => {
  const app = express();
  app.use(localAccess);
  app.get('/health', (_req, res) => res.json({ ready: true }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/health`;
  try {
    for (const origin of [
      `chrome-extension://${EXTENSION_ID}`,
      'http://127.0.0.1:5174',
    ]) {
      const response = await fetch(url, { headers: { Origin: origin } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      const preflight = await fetch(url, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      assert.equal(preflight.status, 204);
      assert.match(
        preflight.headers.get('access-control-allow-methods')!,
        /POST/,
      );
    }
    for (const origin of [
      'https://evil.test',
      'null',
      'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      `chrome-extension://${EXTENSION_ID}.evil.test`,
      'http://127.0.0.1:9999',
    ]) {
      const response = await fetch(url, { headers: { Origin: origin } });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
    assert.equal((await fetch(url)).status, 200);
    const hostStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        const req = request(
          url,
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
    assert.equal(hostStatus, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
