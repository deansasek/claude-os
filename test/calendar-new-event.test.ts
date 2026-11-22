// Checking a new calendar event before it is written (src/apps/calendar/server/new-event.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkNewEvent } from '../src/apps/calendar/server/new-event.ts';

const t0 = Date.UTC(2026, 10, 24, 14, 0);

test('a good event is kept, its name trimmed and its place optional', () => {
  const r = checkNewEvent({ title: '  Dentist  ', start: t0, end: t0 + 30 * 60e3, allDay: false, location: ' Main St ' });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.event, { title: 'Dentist', start: t0, end: t0 + 30 * 60e3, allDay: false, location: 'Main St' });
  const bare = checkNewEvent({ title: 'Bins', start: t0, end: t0 + 60e3, allDay: true });
  assert.equal(bare.ok && bare.event.location, undefined);
});

test('an event with no name, a bad time, or an end before its start is refused', () => {
  assert.equal(checkNewEvent({ title: '', start: t0, end: t0 + 60e3 }).ok, false);
  assert.equal(checkNewEvent({ title: 'x', start: 'soon', end: t0 }).ok, false);
  assert.equal(checkNewEvent({ title: 'x', start: t0, end: t0 - 1 }).ok, false);
  assert.equal(checkNewEvent(null).ok, false);
});

test('a name over 120 characters, or an event over two weeks, is refused', () => {
  assert.equal(checkNewEvent({ title: 'x'.repeat(121), start: t0, end: t0 + 60e3 }).ok, false);
  assert.equal(checkNewEvent({ title: 'Trip', start: t0, end: t0 + 15 * 864e5 }).ok, false);
});
