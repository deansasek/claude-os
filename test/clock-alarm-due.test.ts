// Which alarm occurrence is due: an alarm set just before midnight rings when the check runs just after it. Pure (alarm-due.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueOccurrence, occurrenceKey } from '../src/apps/clock/web/alarm-due.ts';

const GRACE = 3 * 60e3;
const at = (y: number, mo: number, day: number, h: number, m: number, s = 0) => new Date(y, mo, day, h, m, s);
const every = { h: 23, m: 58, days: [], fired: null };

test('an alarm at 23:58 is due at 00:00:30, from yesterday\'s occurrence', () => {
  const t = dueOccurrence(every, at(2026, 10, 27, 0, 0, 30), GRACE);
  assert.ok(t);
  assert.equal(t!.getDate(), 26);
  assert.equal(t!.getHours(), 23);
  assert.equal(occurrenceKey(every, t!), occurrenceKey(every, at(2026, 10, 26, 23, 58)));
});

test('the same alarm at 00:02 is no longer due', () => {
  assert.equal(dueOccurrence(every, at(2026, 10, 27, 0, 2), GRACE), null);
});

test('a weekday-only alarm on Friday 23:59 is due at Saturday 00:01, using Friday', () => {
  const friday = { h: 23, m: 59, days: [5], fired: null };   // 5 = Friday
  const t = dueOccurrence(friday, at(2026, 10, 28, 0, 1), GRACE);   // Saturday 2026-11-28
  assert.ok(t);
  assert.equal(t!.getDay(), 5);
});

test('an occurrence already fired is not due again', () => {
  const fired = { h: 23, m: 58, days: [], fired: occurrenceKey(every, at(2026, 10, 26, 23, 58)) };
  assert.equal(dueOccurrence(fired, at(2026, 10, 27, 0, 0, 30), GRACE), null);
});

test('an on-time alarm is due at its own time', () => {
  const t = dueOccurrence({ h: 7, m: 15, days: [], fired: null }, at(2026, 10, 27, 7, 16), GRACE);
  assert.ok(t);
  assert.equal(t!.getDate(), 27);
});
