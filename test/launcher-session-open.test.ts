// The Apps search opens a session result in the Claude app with that session (src/apps/launcher/web/index.ts, openHit).
// The launcher is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/launcher/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const body = src.slice(src.indexOf('function openHit(h: Hit)'), src.indexOf('// ---------- mount'));

test('a session result opens the Claude app with that session id', () => {
  const branch = body.slice(body.indexOf("h.kind === 'session'"));
  assert.match(branch, /^h\.kind === 'session'\) \{\s*(?:\/\/[^\n]*\s*)?openApp\('claude'\);\s*dispatchEvent\(new CustomEvent\('hub:open-session', \{ detail: h\.ref \}\)\);/);
});

test('the other results keep their own targets', () => {
  assert.match(body, /h\.kind === 'list' \|\| h\.kind === 'item'\) openApp\('lists'\);/);
  assert.match(body, /else openApp\('claude'\);\n\}/);
});
