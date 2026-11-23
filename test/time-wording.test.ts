// The time wording on the screens: relAgo (web/sessions/transcript.ts) and untilText, whenText (core/web/format.ts).
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

// The modules read the page's location when they load (via dom.ts); node has none, so give it one first.
Object.assign(globalThis, { location: { search: '' } });
const { relAgo } = await import('../src/apps/claude/web/sessions/transcript.ts');
const { clock, untilText, whenText } = await import('../src/core/web/format.ts');

const NOW = Date.parse('2026-11-23T12:00:00.000Z');
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

test('relAgo: nothing for a missing or unreadable time', () => {
  assert.equal(relAgo(null, NOW), '');
  assert.equal(relAgo('not a time', NOW), '');
});

test('relAgo: just now, then minutes, hours, and a date once it is a day or more', () => {
  assert.equal(relAgo(ago(20_000), NOW), 'Just now');
  assert.equal(relAgo(ago(MIN), NOW), '1 minute ago');
  assert.equal(relAgo(ago(5 * MIN), NOW), '5 minutes ago');
  assert.equal(relAgo(ago(59 * MIN), NOW), '59 minutes ago');
  assert.equal(relAgo(ago(HOUR), NOW), '1 hour ago');
  assert.equal(relAgo(ago(3 * HOUR), NOW), '3 hours ago');
  assert.equal(relAgo(ago(23 * HOUR), NOW), '23 hours ago');
  // a date and a time, in the tablet's own locale: only the shape is fixed here
  assert.match(relAgo(ago(2 * DAY), NOW), /^.+, .+$/);
});

test('untilText: now, then minutes, hours and days', () => {
  assert.equal(untilText(0), 'now');
  assert.equal(untilText(-1_000), 'now');
  assert.equal(untilText(30_000), '0m');
  assert.equal(untilText(5 * MIN), '5m');
  assert.equal(untilText(59 * MIN + 59_000), '59m');
  assert.equal(untilText(HOUR), '1h 00m');
  assert.equal(untilText(2 * HOUR + 5 * MIN), '2h 05m');
  assert.equal(untilText(23 * HOUR + 59 * MIN), '23h 59m');
  assert.equal(untilText(DAY), '1d 0h');
  assert.equal(untilText(2 * DAY + 3 * HOUR), '2d 3h');
});

test('whenText: a time today, "Tomorrow" and a time tomorrow, then a weekday', () => {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  assert.equal(whenText(today), clock(today));

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  assert.equal(whenText(tomorrow), `Tomorrow ${clock(tomorrow)}`);

  const later = new Date();
  later.setDate(later.getDate() + 3);
  later.setHours(9, 0, 0, 0);
  assert.equal(whenText(later), `${later.toLocaleDateString([], { weekday: 'short' })} ${clock(later)}`);
});
