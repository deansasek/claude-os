// Saved Quiet hours that are not the right shape fall back field by field, so the status line and the DND tile never break. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inQuietWindow, parseQuiet, type QuietHours } from '../src/core/web/quiet-hours.ts';

test('no saved value, null, an array and a string all give the defaults', () => {
  const def = { on: false, days: [1, 2, 3, 4, 5, 6, 0], from: '22:00', to: '07:00', pauseWake: true };
  assert.deepEqual(parseQuiet(null), def);
  assert.deepEqual(parseQuiet('null'), def);
  assert.deepEqual(parseQuiet('[1]'), def);
  assert.deepEqual(parseQuiet('"x"'), def);
});

test('a time that is not H:MM falls back to the default, a valid one is kept', () => {
  const q = parseQuiet(JSON.stringify({ from: 23, to: 'soon' }));
  assert.equal(q.from, '22:00');
  assert.equal(q.to, '07:00');
  assert.equal(parseQuiet(JSON.stringify({ from: '21:30', to: '6:15' })).from, '21:30');
});

test('days keep only whole numbers 0 to 6, and an empty list means every day', () => {
  assert.deepEqual(parseQuiet(JSON.stringify({ days: [1, 'x', 9, 1.5, 3] })).days, [1, 3]);
  assert.deepEqual(parseQuiet(JSON.stringify({ days: ['mon'] })).days, [1, 2, 3, 4, 5, 6, 0]);
});

test('on and pauseWake read as booleans', () => {
  assert.equal(parseQuiet(JSON.stringify({ on: 'yes' })).on, false);
  assert.equal(parseQuiet(JSON.stringify({ on: true, pauseWake: false })).pauseWake, false);
});

// A window check on a local time. day: 0 is Sunday.
const q = (over: Partial<QuietHours>): QuietHours => ({ on: true, days: [0, 1, 2, 3, 4, 5, 6], from: '22:00', to: '07:00', pauseWake: true, ...over });
const at = (day: number, h: number, m: number) => new Date(2026, 10, 22 + day, h, m);   // 2026-11-22 is a Sunday

test('quiet hours that are off are never in the window', () => {
  assert.equal(inQuietWindow(q({ on: false }), at(1, 23, 0)), false);
});

test('a window whose start equals its end is never in the window', () => {
  assert.equal(inQuietWindow(q({ from: '09:00', to: '09:00' }), at(1, 9, 0)), false);
});

test('a same-day window includes its start minute and excludes its end minute', () => {
  const day = q({ from: '09:00', to: '17:00' });
  assert.equal(inQuietWindow(day, at(1, 9, 0)), true);
  assert.equal(inQuietWindow(day, at(1, 17, 0)), false);
  assert.equal(inQuietWindow(day, at(1, 8, 59)), false);
});

test('an overnight window: 23:00 on a chosen day is in, and 07:00 is out', () => {
  const night = q({ days: [1] });   // Monday only
  assert.equal(inQuietWindow(night, at(1, 23, 0)), true);
  assert.equal(inQuietWindow(night, at(2, 7, 0)), false);
});

test('an overnight window gives the small hours to the evening before', () => {
  const monday = q({ days: [1] });
  assert.equal(inQuietWindow(monday, at(2, 6, 59)), true);    // Tuesday 06:59: Monday evening is in days
  assert.equal(inQuietWindow(q({ days: [2] }), at(2, 6, 59)), false);   // Monday evening is not in days
});

test('Sunday early morning checks Saturday, the day before', () => {
  assert.equal(inQuietWindow(q({ days: [6] }), at(0, 6, 0)), true);   // Sunday 06:00: Saturday evening is in days
  assert.equal(inQuietWindow(q({ days: [0] }), at(0, 6, 0)), false);
});
