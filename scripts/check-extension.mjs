import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
const id = [...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)]
  .map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
assert.ok((await readFile('src/config.ts', 'utf8')).includes(`'${id}'`), 'Companion origin must match the extension public key.');
for (const file of ['index.html', manifest.action.default_popup, manifest.background.service_worker]) {
  await access(`dist/${file}`);
}
for (const page of ['index.html', 'popup.html']) {
  const html = await readFile(`dist/${page}`, 'utf8');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html), 'No inline scripts in extension pages.');
  assert.ok(!/https?:\/\/[^"']+\.js/.test(html), 'No remote executable scripts.');
}
console.log(`Manifest V3 validated. Stable extension ID: ${id}`);
