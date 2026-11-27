// The Photos list read gives up on a PC that does not answer, and a late older read does not bring back deleted photos
// (src/apps/photos/web/index.ts load, removePending). The module talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/photos/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const load = slice('async function load(');
const removePending = slice('async function removePending(');

test('the timeout is set and at most 30 seconds, and the list read passes it', () => {
  const m = src.match(/const LIST_TIMEOUT_MS = ([\d.e]+);/);
  assert.ok(m, 'LIST_TIMEOUT_MS is defined');
  assert.ok(Number(m[1]) > 0 && Number(m[1]) <= 30e3);
  assert.match(load, /getJson<PhotoList>\('\/api\/photos\/list', LIST_TIMEOUT_MS\)/);
});

test('each read takes the next number, and both paths drop a read that is no longer the newest', () => {
  assert.match(load, /const seq = \+\+listSeq;/);
  const guards = load.match(/if \(seq !== listSeq\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
  assert.ok(load.indexOf('if (seq !== listSeq) return;') < load.indexOf('days = nextPhotoDays'), 'the first check comes before the grid is set');
});

test('a delete drops any list read still out, after the photos are removed', () => {
  const filter = removePending.indexOf('days = days.map(');
  const bump = removePending.indexOf('listSeq++;');
  assert.ok(filter > 0 && bump > filter, 'the bump comes after the delete filter');
});
