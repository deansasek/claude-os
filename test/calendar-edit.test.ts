// Editing and deleting a ClaudeOS event (local.ts, edit.ts, range-merge.ts): local-update changes only the fields sent,
// local-delete removes the event, and only ClaudeOS events can be edited or deleted. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';
import type { LocalEvent } from '../src/apps/calendar/server/local.ts';

// The store reads its file path when it loads, so the scratch file is set before the import.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-cal-edit-'));
process.env.CLAUDEOS_CALENDAR_LOCAL_FILE = path.join(dir, 'calendar-local.json');
const L = await import('../src/apps/calendar/server/local.ts');
const { mergeRange } = await import('../src/apps/calendar/server/range-merge.ts');
const { afterWriteNote, editable, formCanShow, ownEvent } = await import('../src/apps/calendar/web/edit.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => fs.rmSync(L.FILE, { force: true }));

const at = (d: number, h = 0, m = 0): number => new Date(2026, 10, d, h, m).getTime();   // November 2026, local time

/** The event a good add or update made; fails the test when there is none. */
function eventOf(r: { status: string; event?: LocalEvent; error?: string }): LocalEvent {
  if (r.status !== 'ok' || !r.event) throw new Error(`no event: ${JSON.stringify(r)}`);
  return r.event;
}

test('local-update changes only the fields sent and keeps the rest', () => {
  const before = eventOf(L.addLocalEvent({ title: 'Dentist', start: at(10, 9), end: at(10, 10), allDay: false, location: 'Clinic' }));
  const r = L.updateLocalEvent({ id: before.id, title: 'Dentist (moved)' });
  assert.equal(r.status, 'ok');
  const [after1] = L.localEventsBetween(at(10), at(11));
  assert.deepEqual(after1, { ...before, title: 'Dentist (moved)' });

  L.updateLocalEvent({ id: before.id, start: at(10, 14), end: at(10, 15) });
  const [after2] = L.localEventsBetween(at(10), at(11));
  assert.equal(after2.title, 'Dentist (moved)');
  assert.equal(after2.location, 'Clinic');
  assert.equal(after2.allDay, false);
  assert.equal(after2.start, at(10, 14));
  assert.equal(after2.calendar, 'claudeos');
  assert.equal(after2.id, before.id);
});

test('local-update with an empty place clears the place and keeps the times', () => {
  const e = eventOf(L.addLocalEvent({ title: 'Lunch', start: at(11, 12), end: at(11, 13), allDay: false, location: 'Cafe' }));
  assert.equal(L.updateLocalEvent({ id: e.id, location: '' }).status, 'ok');
  const [now] = L.localEventsBetween(at(11), at(12));
  assert.equal(now.location, undefined);
  assert.equal(now.title, 'Lunch');
  assert.equal(now.start, at(11, 12));
  assert.equal(now.end, at(11, 13));
});

test('local-delete removes the event from the calendar and the file', () => {
  const e = eventOf(L.addLocalEvent({ title: 'Gone', start: at(12, 9), end: at(12, 10), allDay: false }));
  assert.deepEqual(L.deleteLocalEvent(e.id), { status: 'ok', removed: 1 });
  assert.deepEqual(L.localEventsBetween(at(12), at(13)), []);
  const saved = JSON.parse(fs.readFileSync(L.FILE, 'utf8')) as { events: unknown[] };
  assert.equal(saved.events.length, 0);
  assert.deepEqual(L.deleteLocalEvent(e.id), { status: 'ok', removed: 0 });
});

test('an update or delete of an event that is gone is refused or does nothing', () => {
  const e = eventOf(L.addLocalEvent({ title: 'Once', start: at(13, 9), end: at(13, 10), allDay: false }));
  L.deleteLocalEvent(e.id);
  assert.equal(L.updateLocalEvent({ id: e.id, title: 'Back' }).status, 'error');
});

test('only a ClaudeOS event with an id is editable: external events have no Edit or Delete', () => {
  const local = { id: 'abcd1234efgh', title: 'Dentist', start: at(10, 9), end: at(10, 10), allDay: false, calendar: 'claudeos' };
  const ics = { title: 'Team call', start: at(10, 9), end: at(10, 10), allDay: false, calendar: 'ics' };
  const connector = { title: 'Flight', start: at(10, 9), end: at(10, 10), allDay: false, calendar: 'connector' };
  const noId = { title: 'Old', start: at(10, 9), end: at(10, 10), allDay: false, calendar: 'claudeos' };
  assert.equal(ownEvent(local), true);
  assert.equal(editable(local), true);
  for (const external of [ics, connector, noId]) {
    assert.equal(ownEvent(external), false);
    assert.equal(editable(external), false);
  }
});

test('a ClaudeOS event that runs over midnight is not editable in the add form', () => {
  const overnight = { id: 'abcd1234efgh', title: 'Night', start: at(10, 22), end: at(11, 2), allDay: false, calendar: 'claudeos' };
  assert.equal(formCanShow(overnight), false);
  assert.equal(editable(overnight), false);
  assert.equal(formCanShow({ ...overnight, start: at(10, 9), end: at(10, 10) }), true);
});

test('an all-day event is editable only when it covers one whole day', () => {
  const oneDay = { id: 'abcd1234efgh', title: 'Bins', start: at(10), end: at(11), allDay: true, calendar: 'claudeos' };
  assert.equal(formCanShow(oneDay), true);
  assert.equal(formCanShow({ ...oneDay, end: at(12) }), false);
});

test('a merged range keeps the id of a ClaudeOS event and marks only it as editable', () => {
  const local = eventOf(L.addLocalEvent({ title: 'Mine', start: at(14, 9), end: at(14, 10), allDay: false }));
  const ext = { status: 'ok' as const, events: [{ title: 'Team call', start: at(14, 11), end: at(14, 12), allDay: false, calendar: 'ics' }] };
  const merged = mergeRange(ext, L.localEventsBetween(at(14), at(15)), null);
  const mine = merged.events.find(e => e.title === 'Mine');
  const theirs = merged.events.find(e => e.title === 'Team call');
  assert.equal(mine?.id, local.id);
  assert.equal(ownEvent(mine!), true);
  assert.equal(ownEvent(theirs!), false);
});

test('afterWriteNote gives the done text alone when the reload has no note', () => {
  assert.equal(afterWriteNote('Added “Dentist” to ClaudeOS.', ''), 'Added “Dentist” to ClaudeOS.');
});

test('afterWriteNote keeps the connection note after the done text', () => {
  const done = 'Added “Dentist” to ClaudeOS.';
  const note = 'Couldn’t reach the PC, so this may be out of date. Trying again…';
  assert.equal(afterWriteNote(done, note), `${done} ${note}`);
});

test('afterWriteNote keeps the stale note after the done text', () => {
  const done = 'Saved “Dentist” in ClaudeOS.';
  const note = 'Couldn’t read the calendar just now, so this may be out of date. Calendar timed out';
  assert.equal(afterWriteNote(done, note), `${done} ${note}`);
});

test('afterWriteNote keeps the error note after the done text', () => {
  const done = 'Deleted “Dentist” from ClaudeOS.';
  const note = 'Couldn’t read the calendar.';
  assert.equal(afterWriteNote(done, note), `${done} ${note}`);
});
