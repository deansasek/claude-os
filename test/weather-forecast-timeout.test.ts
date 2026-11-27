// The Weather app's forecast read gives up on a PC that does not answer, and a late older read does not paint over a new place
// (src/apps/weather/web/index.ts loadWx, sendLocation). The module talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/weather/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const loadWx = slice('async function loadWx(');
const sendLocation = slice('async function sendLocation(');

test('the forecast read has a timeout', () => {
  assert.match(src, /const WX_TIMEOUT_MS = 20e3;/);
  assert.match(loadWx, /getJson<Weather>\(`\/api\/weather\/forecast\$\{loc\}`, WX_TIMEOUT_MS\)/);
});

test('each read takes the next number, and both paths drop a read that is no longer the newest', () => {
  assert.match(loadWx, /const seq = \+\+wxSeq;/);
  const guards = loadWx.match(/if \(seq !== wxSeq\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
  assert.ok(loadWx.indexOf('if (seq !== wxSeq) return;') < loadWx.indexOf('wx = next;'), 'the first check comes before the forecast is set');
});

test('a saved place or unit drops any forecast read still out', () => {
  assert.match(sendLocation, /wxSeq\+\+;/);
  assert.ok(sendLocation.indexOf('wxSeq++;') > sendLocation.indexOf('NotSaved'), 'the bump comes after the save is checked');
});
