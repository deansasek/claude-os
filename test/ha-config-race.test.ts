// A late older Home Assistant config save does not overwrite a newer one (src/apps/home-assistant/web/index.ts saveConfig).
// The page is DOM code, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/home-assistant/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function saveConfig(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('each config save takes the next number before its POST', () => {
  assert.ok(start > 0, 'saveConfig() exists');
  assert.match(src, /let configGen = 0;/);
  const take = body.indexOf('const gen = ++configGen;');
  const post = body.indexOf('postJson<HaStatus & { ok: boolean; message?: string }>');
  assert.ok(take > 0 && post > take, 'the number is taken before the POST');
});

test('an older reply sets the status and the message only while its save is still the newest', () => {
  assert.match(body, /if \(gen === configGen\) \{ status = r; testMsg = /);
  assert.match(body, /catch \{ if \(gen === configGen\) testMsg = 'Can’t reach the PC right now\.'; \}/);
});
