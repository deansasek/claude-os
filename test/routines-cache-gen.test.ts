// A read that started before a hub:routines event does not refill the Routines cache with the old list
// (src/apps/routines/web/run.ts loadRoutines). The module pulls in DOM code, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/routines/web/run.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('export async function loadRoutines(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the cache generation is taken before the read and checked before the cache is set', () => {
  assert.ok(start > 0, 'loadRoutines() exists');
  assert.match(src, /let cacheGen = 0;/);
  const take = body.indexOf('const gen = cacheGen;');
  const read = body.indexOf("getJson<RoutinesResult>('/api/routines/list'");
  assert.ok(take > 0 && read > take, 'the generation is taken before the read');
  assert.match(body, /if \(gen === cacheGen\) \{ cache = r\.routines; cacheAt = Date\.now\(\); \}/);
});

test('the hub:routines event clears the cache and bumps the generation', () => {
  assert.match(src, /addEventListener\('hub:routines', \(\) => \{ cache = null; cacheGen\+\+; \}\);/);
});
