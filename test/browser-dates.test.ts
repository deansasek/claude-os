// The Browser app's date wording: ago() and dayOf() in src/apps/browser/web/state.ts. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

// state.ts imports core/web/dom.ts, which reads the page's location when it loads; node has none, so give it one first.
Object.assign(globalThis, { location: { search: '' } });
const { ago, dayOf } = await import('../src/apps/browser/web/state.ts');

// A fixed "now": 26 November 2026, noon, local time.
const NOW = new Date(2026, 10, 26, 12, 0, 0).getTime();
const HOUR = 60 * 60_000;

// The date part of ago() and the day heading of dayOf(), built with the same options the code uses.
const shortDate = (d: Date, year: boolean) => d.toLocaleDateString([], { day: 'numeric', month: 'short', year: year ? 'numeric' : undefined });
const dayDate = (d: Date, year: boolean) => d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: year ? 'numeric' : undefined });

test('ago: today is shown in hours', () => {
  assert.equal(ago(NOW - 2 * HOUR, NOW), '2 h ago');
});

test('ago: yesterday, past 24 hours, is shown as a date with no year', () => {
  const at = NOW - 30 * HOUR;
  assert.equal(ago(at, NOW), shortDate(new Date(at), false));
});

test('ago: an earlier date this year is shown with no year', () => {
  const at = new Date(2026, 2, 5, 12).getTime();
  assert.equal(ago(at, NOW), shortDate(new Date(at), false));
});

test('ago: a date last year is shown with the year', () => {
  const at = new Date(2025, 10, 26, 12).getTime();
  assert.equal(ago(at, NOW), shortDate(new Date(at), true));
});

test('dayOf: today', () => {
  assert.equal(dayOf(new Date(2026, 10, 26, 8).getTime(), NOW), 'Today');
});

test('dayOf: yesterday', () => {
  assert.equal(dayOf(new Date(2026, 10, 25, 20).getTime(), NOW), 'Yesterday');
});

test('dayOf: an earlier date this year is shown with no year', () => {
  const at = new Date(2026, 2, 5, 12).getTime();
  assert.equal(dayOf(at, NOW), dayDate(new Date(at), false));
});

test('dayOf: a date last year is shown with the year', () => {
  const at = new Date(2025, 10, 26, 12).getTime();
  assert.equal(dayOf(at, NOW), dayDate(new Date(at), true));
});
