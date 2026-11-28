// A day's events include any that overlap the day (src/core/web/voice-calendar.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { overlapsDay } from '../src/core/web/voice-calendar.ts';

const day = (d: number) => Date.parse(`2026-12-${String(d).padStart(2, '0')}T00:00:00`);
const DAY_END = (d: number) => day(d + 1);

test('a multi-day all-day event is on each day it covers', () => {
  const visit = { title: 'Grandma visiting', start: day(4), end: day(7), allDay: true };
  assert.equal(overlapsDay([visit], day(5), DAY_END(5)).length, 1);
  assert.equal(overlapsDay([visit], day(6), DAY_END(6)).length, 1);
  assert.equal(overlapsDay([visit], day(7), DAY_END(7)).length, 0);
});

test('an event that began the day before and runs past midnight is on the next day', () => {
  const late = { title: 'Late film', start: Date.parse('2026-12-05T22:00:00'), end: Date.parse('2026-12-06T01:00:00'), allDay: false };
  assert.equal(overlapsDay([late], day(6), DAY_END(6)).length, 1);
  assert.equal(overlapsDay([late], day(7), DAY_END(7)).length, 0);
});

test('an event that ends before the day starts, or starts after it, is not on the day', () => {
  const before = { title: 'Dentist', start: day(3) + 9 * 3600e3, end: day(3) + 10 * 3600e3, allDay: false };
  const after = { title: 'Party', start: day(6) + 18 * 3600e3, end: day(6) + 20 * 3600e3, allDay: false };
  assert.equal(overlapsDay([before, after], day(5), DAY_END(5)).length, 0);
});
