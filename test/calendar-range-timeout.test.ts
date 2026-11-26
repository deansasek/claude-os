// The calendar range read gives up after RANGE_TIMEOUT_MS (src/apps/calendar/web/index.ts, load). The Calendar screen is DOM
// code with no unit seam, so this reads the source of load(). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/calendar/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function load(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the calendar range read gives up after RANGE_TIMEOUT_MS', () => {
  assert.ok(start > 0, 'load() exists');
  assert.match(body, /getJson<RangeAnswer>\([^;]*, RANGE_TIMEOUT_MS\)/);
  assert.match(src, /const RANGE_TIMEOUT_MS = 20_000;/);
});

test('a timed-out range read keeps the events only for the range they were read for', () => {
  const catchAt = body.lastIndexOf('} catch {');
  assert.ok(catchAt > 0, 'load() has a catch');
  const catchBody = body.slice(catchAt);
  // The catch must not clear events unconditionally.
  assert.doesNotMatch(catchBody, /failed = true;\s*events = \[\];/);
  // It compares the range key before it clears.
  const keyAt = catchBody.indexOf('eventsRange !== now');
  const clearAt = catchBody.indexOf('events = [];');
  assert.ok(keyAt > 0, 'the catch compares eventsRange with the current range');
  assert.ok(clearAt > keyAt, 'the clear comes after the range comparison');
  // The PC answers record the range key they were read for.
  assert.match(body, /events = r\.events \?\? \[\];\s*eventsRange = rangeKey\(\{ from, to \}\);/);
  assert.match(catchBody, /Couldn’t reach the PC, so this may be out of date\. Trying again…/);
});
