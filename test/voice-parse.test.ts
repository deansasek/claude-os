// Voice parsing for durations, times of day and day lists (src/core/web/voice-parse.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDays, parseDuration, parseTime } from '../src/core/web/voice-parse.ts';

test('a duration phrase becomes milliseconds', () => {
  assert.equal(parseDuration('10 minutes'), 600_000);
  assert.equal(parseDuration('a minute and a half'), 90_000);
  assert.equal(parseDuration('1 hour 30 minutes'), 5_400_000);
  assert.equal(parseDuration('nonsense'), null);
  assert.equal(parseDuration('30 hours'), null);   // over 24 hours
});

test('a time of day is read with or without am and pm', () => {
  assert.deepEqual(parseTime('7'), { h: 7, m: 0, meridiem: null });
  assert.deepEqual(parseTime('6 30 am'), { h: 6, m: 30, meridiem: 'am' });
  assert.deepEqual(parseTime('half past 6'), { h: 6, m: 30, meridiem: null });
  assert.deepEqual(parseTime('quarter to 7'), { h: 6, m: 45, meridiem: null });
  assert.deepEqual(parseTime('noon'), { h: 12, m: 0, meridiem: 'pm' });
  assert.equal(parseTime('25'), null);
  assert.equal(parseTime('some time'), null);
});

test('a day list becomes day numbers, and no days means once', () => {
  assert.deepEqual(parseDays(''), []);
  assert.deepEqual(parseDays('tomorrow'), []);
  assert.deepEqual(parseDays('every day'), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(parseDays('on weekdays'), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseDays('on mondays'), [1]);
  assert.deepEqual(parseDays('every monday and friday'), [1, 5]);
  assert.equal(parseDays('frobnicate'), null);
});
