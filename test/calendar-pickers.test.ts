// The add-event day and time pickers' logic (src/apps/calendar/web/pickers.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { minutesOf, monthWeeks, shiftEnd, stepClock } from '../src/apps/calendar/web/pickers.ts';

test('a clock time reads as minutes from midnight; anything else is refused', () => {
  assert.equal(minutesOf('09:30'), 570);
  assert.equal(minutesOf('0:00'), 0);
  assert.equal(minutesOf('24:00'), null);
  assert.equal(minutesOf('09:60'), null);
  assert.equal(minutesOf('9.30'), null);
});

test('a clock time steps by minutes and wraps at midnight', () => {
  assert.equal(stepClock('09:00', 5), '09:05');
  assert.equal(stepClock('23:30', 60), '00:30');
  assert.equal(stepClock('00:00', -5), '23:55');
  assert.equal(stepClock('bad', 60), '01:00');   // an unreadable time counts from midnight
});

test('moving the start keeps the length of the event', () => {
  assert.equal(shiftEnd('09:00', '10:00', '09:30'), '10:30');   // 30 minutes long
  assert.equal(shiftEnd('09:00', '08:00', '11:00'), '10:00');   // 2 hours long
});

test('a start with no usable length, or an unreadable end, gets 30 minutes', () => {
  assert.equal(shiftEnd('09:00', '09:00', '09:00'), '09:30');
  assert.equal(shiftEnd('09:00', '11:00', 'bad'), '11:30');
});

test('the day grid starts on the first day, Monday first, and pads the last week', () => {
  // November 2026 starts on a Sunday, so six empty cells come before the 1st
  const weeks = monthWeeks(2026, 10);
  assert.equal(weeks.length, 6);
  assert.equal(weeks.every(w => w.length === 7), true);
  assert.deepEqual(weeks[0].slice(0, 6), [null, null, null, null, null, null]);
  assert.equal(weeks[0][6], '2026-11-01');
  assert.equal(weeks[5][0], '2026-11-30');
  assert.equal(weeks[5][1], null);
});
