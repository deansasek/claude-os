// The calendar range the Calendar app asks for (src/apps/calendar/server/range.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rangeBounds } from '../src/apps/calendar/server/range.ts';

test('a range of days is read from its first local midnight to its last', () => {
  const r = rangeBounds('2026-11-01', '2026-11-08');
  assert.ok(r);
  assert.ok(Math.abs(r!.to - r!.from - 7 * 864e5) <= 2 * 3600e3);   // 7 days, allowing for a clock change
  assert.equal(new Date(r!.from).getDate(), 1);
  assert.equal(new Date(r!.to).getDate(), 8);
});

test('a year view range is allowed, a range that is too wide is not', () => {
  assert.ok(rangeBounds('2026-01-01', '2027-01-01'));
  assert.equal(rangeBounds('2020-01-01', '2026-01-01'), null);
});

test('a range that is empty, backwards, or not a date is refused', () => {
  assert.equal(rangeBounds('2026-11-08', '2026-11-08'), null);
  assert.equal(rangeBounds('2026-11-09', '2026-11-08'), null);
  assert.equal(rangeBounds('tomorrow', '2026-11-08'), null);
  assert.equal(rangeBounds('2026-11-01', ''), null);
});
