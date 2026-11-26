// The saved Clock alarms that Home and the status line read: a bad entry is left out, the others are kept. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseClockAlarms } from '../src/core/web/clock-alarms.ts';

const good = { h: 7, m: 30, on: true, days: [1, 2, 3], snooze: null };

test('null entries, numbers and objects with no hour are left out, and the good alarm is kept', () => {
  const list = JSON.stringify([null, 5, { h: 7 }, good]);
  assert.deepEqual(parseClockAlarms(list, null), [good]);
});

test('a list that is not an array falls back to the old single alarm key', () => {
  assert.deepEqual(parseClockAlarms('{}', JSON.stringify({ h: 6, m: 0, on: true })), [{ h: 6, m: 0, on: true, snooze: null }]);
  assert.deepEqual(parseClockAlarms(null, null), []);
});

test('an hour or minute out of range, or a bad day list, drops only that field', () => {
  assert.deepEqual(parseClockAlarms(JSON.stringify([{ h: 24, m: 0, on: true }, { h: 1, m: 60, on: true }]), null), []);
  const bad = parseClockAlarms(JSON.stringify([{ h: 8, m: 0, on: true, days: ['mon', 9] }]), null);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].days, undefined, 'a bad day list is dropped, so the alarm rings every day');
});

test('a snooze that is not a number reads as none', () => {
  assert.equal(parseClockAlarms(JSON.stringify([{ h: 8, m: 0, on: true, snooze: '12:00' }]), null)[0].snooze, null);
});
