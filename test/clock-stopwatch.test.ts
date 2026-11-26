// The saved stopwatch loads field by field: a bad stored value gives a stopped stopwatch, never a broken one. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStopwatch } from '../src/apps/clock/web/stopwatch.ts';

const stopped = { running: false, start: 0, acc: 0, laps: [] };

test('no saved value, bad JSON, an array and a string all give a stopped stopwatch', () => {
  assert.deepEqual(parseStopwatch(null), stopped);
  assert.deepEqual(parseStopwatch('{ broken'), stopped);
  assert.deepEqual(parseStopwatch('[1,2]'), stopped);
  assert.deepEqual(parseStopwatch('"x"'), stopped);
});

test('laps that are not a list of numbers are dropped, and the good laps are kept', () => {
  assert.deepEqual(parseStopwatch(JSON.stringify({ laps: null })).laps, []);
  assert.deepEqual(parseStopwatch(JSON.stringify({ laps: 'x' })).laps, []);
  assert.deepEqual(parseStopwatch(JSON.stringify({ laps: [1000, 'bad', null, 2500] })).laps, [1000, 2500]);
});

test('a string acc reads as zero, not NaN', () => {
  assert.equal(parseStopwatch(JSON.stringify({ acc: '5' })).acc, 0);
});

test('a running stopwatch with no valid start loads as stopped', () => {
  const s = parseStopwatch(JSON.stringify({ running: true, start: 0, acc: 300 }));
  assert.equal(s.running, false);
  assert.equal(s.start, 0);
  assert.equal(s.acc, 300);
});

test('a running stopwatch with a start keeps running from it', () => {
  const s = parseStopwatch(JSON.stringify({ running: true, start: 1700000000000, acc: 0, laps: [500] }));
  assert.deepEqual(s, { running: true, start: 1700000000000, acc: 0, laps: [500] });
});
