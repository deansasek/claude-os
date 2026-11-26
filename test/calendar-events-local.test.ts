// Today's and tomorrow's events include the ClaudeOS calendar's events: a pure merge, so Node can run it. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withLocalDays } from '../src/apps/calendar/server/range-merge.ts';

const d0 = new Date(2026, 10, 26).getTime();
const d1 = d0 + 864e5;
const d2 = d1 + 864e5;
const ok = { status: 'ok' as const, events: [], today: '2026-11-26' };
const at = (day: number, h: number) => d0 + day * 864e5 + h * 36e5;

test('a ClaudeOS event today and one tomorrow are added, labelled by day', () => {
  const r = withLocalDays(ok, [
    { title: 'Dentist', start: at(0, 9), end: at(0, 10), allDay: false },
    { title: 'Trip', start: at(1, 14), end: at(1, 15), allDay: false, location: 'Airport' },
  ], d0, d1, d2);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.events.map(e => [e.title, e.day]), [['Dentist', 'today'], ['Trip', 'tomorrow']]);
  assert.equal(r.events[1].location, 'Airport');
});

test('an event outside today and tomorrow is left out', () => {
  const r = withLocalDays(ok, [{ title: 'Later', start: at(5, 9), end: at(5, 10), allDay: false }], d0, d1, d2);
  assert.equal(r.events.length, 0);
});

test('all-day events come first, then by start time', () => {
  const r = withLocalDays(ok, [
    { title: 'Late', start: at(0, 15), end: at(0, 16), allDay: false },
    { title: 'Holiday', start: d0, end: d1, allDay: true },
  ], d0, d1, d2);
  assert.deepEqual(r.events.map(e => e.title), ['Holiday', 'Late']);
});

test('a failed read with ClaudeOS events shows them as stale, with the error', () => {
  const r = withLocalDays({ status: 'error', events: [], today: '2026-11-26', error: 'offline' },
    [{ title: 'Dentist', start: at(0, 9), end: at(0, 10), allDay: false }], d0, d1, d2);
  assert.equal(r.status, 'ok');
  assert.equal(r.stale, true);
  assert.equal(r.error, 'offline');
  assert.equal(r.events[0].title, 'Dentist');
});

test('a failed read with no ClaudeOS events stays a failed read', () => {
  const err = { status: 'error' as const, events: [], today: '2026-11-26', error: 'offline' };
  assert.deepEqual(withLocalDays(err, [], d0, d1, d2), err);
});
