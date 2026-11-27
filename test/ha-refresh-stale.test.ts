// The Home Assistant dashboard refresh gives up on a read the PC never answers, and a refresh that answers after a layout
// edit does not undo the edit (src/apps/home-assistant/web/index.ts refresh). The module talks to the tablet at load, so
// this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/home-assistant/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const refresh = slice('async function refresh(');
const loadStatus = slice('async function loadStatus(');

test('the layout read and the status read both have a timeout', () => {
  assert.match(src, /const READ_TIMEOUT_MS = 10_000;/);
  assert.match(refresh, /getJson<HaDashboard>\(`\$\{API\}\/layout`, READ_TIMEOUT_MS\)/);
  assert.match(loadStatus, /getJson<HaStatus>\(`\$\{API\}\/status`, READ_TIMEOUT_MS\)/);
});

test('a refresh takes the layout generation before it reads, and only applies the answer if it is still current', () => {
  const gen = refresh.indexOf('const gen = layoutGen;');
  const read = refresh.indexOf('await getJson<HaDashboard>');
  assert.ok(gen > 0 && read > gen, 'the generation is taken before the read');
  assert.match(refresh, /if \(gen === layoutGen\) dash = d;/);
  assert.doesNotMatch(refresh, /\bdash = await /);
});

test('each layout edit bumps the generation', () => {
  assert.match(slice('async function saveLayout('), /layoutGen\+\+;/);
  assert.match(slice('async function setOnHome('), /layoutGen\+\+;/);
});
