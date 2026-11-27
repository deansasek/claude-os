// The Home Today tile's calendar read gives up on a PC that does not answer, and a late older read does not paint over a newer one
// (src/apps/home/web/index.ts loadCalendar). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/home/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const load = slice('async function loadCalendar(');
const connector = slice('async function cachedConnectorCal(');

test('the timeout is shorter than the 2 minute poll, and every calendar read uses it', () => {
  assert.match(src, /const CAL_TIMEOUT_MS = 20e3;/);
  assert.match(src, /const CAL_EVERY_MS = 2 \* 60e3;/);
  assert.match(load, /getJson<CalEvents>\('\/api\/calendar\/events', CAL_TIMEOUT_MS\)/);
  assert.equal((connector.match(/CAL_TIMEOUT_MS\)/g) ?? []).length, 2, 'both connector reads have the timeout');
});

test('each read takes the next number, and every await checks it before the tile changes', () => {
  assert.match(load, /const seq = \+\+calSeq;/);
  const guards = load.match(/if \(seq !== calSeq\) return;/g) ?? [];
  assert.ok(guards.length >= 3, `at least three guards, found ${guards.length}`);
  assert.ok(load.indexOf('if (seq !== calSeq) return;') < load.indexOf('cal = r;'), 'the first guard comes before the events are set');
});
