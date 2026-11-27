// The Radio catalogue reads give up on a PC that does not answer, and a timeout counts as the PC being down, so the lists and Home
// shelves do not stay loading (src/apps/radio/web/index.ts). The module talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/radio/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('the catalogue timeout is defined', () => {
  assert.match(src, /const CATALOGUE_TIMEOUT_MS = 10e3;/);
});

test('every catalogue read passes the timeout', () => {
  const lines = src.split('\n').filter(l => /getJson<(?:StationsResult|FacetsResult)>/.test(l));
  assert.ok(lines.length >= 5, `found ${lines.length} catalogue reads`);
  for (const l of lines) assert.match(l, /CATALOGUE_TIMEOUT_MS\)/, `read passes the timeout: ${l.trim().slice(0, 70)}`);
});

test('a timeout counts as the PC being down, as a refused connection does', () => {
  assert.match(src, /const cantReach = \(e: unknown\): boolean => e instanceof TypeError \|\| \(e as \{ name\?: string \} \| null\)\?\.name === 'TimeoutError';/);
  assert.match(src, /const unreachable = \(r: PromiseSettledResult<unknown>\): boolean => r\.status === 'rejected' && cantReach\(r\.reason\);/);
  assert.match(src, /pcDown = cantReach\(e\);/);
});
