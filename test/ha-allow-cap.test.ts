// The Home Assistant allowlist holds 500 devices. A full list refuses the next device with an error, and never reports ok for a device it dropped.
// Source-text check on ha.ts, which imports the PC's config and Home Assistant client. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/home-assistant/server/ha.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('export function setAllowed(');
const body = src.slice(start, src.indexOf('// ---------- what the routes', start));

test('setAllowed refuses a turn-on when the real list is already full', () => {
  assert.match(body, /if \(on && !isDemo\(\) && list\.length >= 500\) return \{ ok: false, error: /);
});

test('the refusal comes before the device is pushed', () => {
  assert.ok(body.indexOf('list.length >= 500') < body.indexOf('list.push(id)'));
});

test('setAllowed no longer cuts the list, so no ok reply follows a dropped device', () => {
  assert.doesNotMatch(body, /slice\(0, 500\)/);
});
