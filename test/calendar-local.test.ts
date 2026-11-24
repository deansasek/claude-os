// The ClaudeOS calendar's own events (src/apps/calendar/server/local.ts): add, list a range, update, delete, and the checks. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';
import type { LocalEvent, LocalResult } from '../src/apps/calendar/server/local.ts';

// The store reads its file path when it loads, so the scratch file is set before the import.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-cal-local-'));
process.env.CLAUDEOS_CALENDAR_LOCAL_FILE = path.join(dir, 'calendar-local.json');
const L = await import('../src/apps/calendar/server/local.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => fs.rmSync(L.FILE, { force: true }));

/** The event a good add or update made; fails the test when there is none. */
function eventOf(r: LocalResult): LocalEvent {
  if (r.status !== 'ok' || !r.event) throw new Error(`no event: ${JSON.stringify(r)}`);
  return r.event;
}

const at = (d: number, h = 0): number => new Date(2026, 10, d, h).getTime();   // November 2026, local time
const ev = (title: string, start: number, end: number, extra: Record<string, unknown> = {}) => ({ title, start, end, allDay: false, ...extra });

test('an event is added to the ClaudeOS calendar with an id and no account', () => {
  const r = L.addLocalEvent(ev('Dentist', at(10, 9), at(10, 10), { location: 'High Street' }));
  assert.equal(r.status, 'ok');
  const e = eventOf(r);
  assert.match(e.id, /^[a-z0-9]{8,32}$/);
  assert.equal(e.calendar, 'claudeos');
  assert.equal(e.title, 'Dentist');
  assert.equal(e.location, 'High Street');
  assert.equal(fs.existsSync(L.FILE), true);
});

test('listing a range returns the events that overlap it, in start order', () => {
  L.addLocalEvent(ev('Late', at(12, 15), at(12, 16)));
  L.addLocalEvent(ev('Early', at(12, 8), at(12, 9)));
  L.addLocalEvent(ev('Next week', at(20, 8), at(20, 9)));
  const day = L.localEventsBetween(at(12), at(13)).map(e => e.title);
  assert.deepEqual(day, ['Early', 'Late']);
  assert.deepEqual(L.localEventsBetween(at(14), at(30)).map(e => e.title), ['Next week']);
  assert.deepEqual(L.localEventsBetween(at(1), at(5)), []);
});

test('an event over midnight is listed on each day it touches', () => {
  L.addLocalEvent(ev('Overnight', at(12, 22), at(13, 2)));
  assert.equal(L.localEventsBetween(at(12), at(13)).length, 1);
  assert.equal(L.localEventsBetween(at(13), at(14)).length, 1);
});

test('an event can be updated: fields not sent keep their values, and the id stays', () => {
  const id = eventOf(L.addLocalEvent(ev('Dentist', at(10, 9), at(10, 10)))).id;
  const r = L.updateLocalEvent({ id, title: 'Dentist (moved)', start: at(10, 11), end: at(10, 12) });
  assert.equal(r.status, 'ok');
  const list = L.localEventsBetween(at(10), at(11));
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.equal(list[0].title, 'Dentist (moved)');
  assert.equal(list[0].start, at(10, 11));
  const keepTitle = L.updateLocalEvent({ id, location: 'Clinic' });
  assert.equal(keepTitle.status, 'ok');
  assert.equal(L.localEventsBetween(at(10), at(11))[0].title, 'Dentist (moved)');
});

test('an event can be deleted, and deleting one that is gone is not an error', () => {
  const id = eventOf(L.addLocalEvent(ev('Gone soon', at(15, 9), at(15, 10)))).id;
  assert.deepEqual(L.deleteLocalEvent(id), { status: 'ok', removed: 1 });
  assert.deepEqual(L.localEventsBetween(at(15), at(16)), []);
  assert.deepEqual(L.deleteLocalEvent(id), { status: 'ok', removed: 0 });
});

test('the title and the times are checked before anything is saved', () => {
  assert.equal(L.addLocalEvent(ev('', at(10, 9), at(10, 10))).status, 'error');
  assert.equal(L.addLocalEvent(ev('x'.repeat(121), at(10, 9), at(10, 10))).status, 'error');
  assert.equal(L.addLocalEvent(ev('Backwards', at(10, 10), at(10, 9))).status, 'error');
  assert.equal(L.addLocalEvent(ev('Empty', at(10, 9), at(10, 9))).status, 'error');
  assert.equal(L.addLocalEvent(ev('Too long', at(1), at(30))).status, 'error');
  assert.equal(fs.existsSync(L.FILE), false, 'a refused event writes nothing');
});

test('an update that makes the event end before it starts is refused and the event keeps its times', () => {
  const id = eventOf(L.addLocalEvent(ev('Lunch', at(11, 12), at(11, 13)))).id;
  const r = L.updateLocalEvent({ id, end: at(11, 11) });
  assert.equal(r.status, 'error');
  assert.equal(L.localEventsBetween(at(11), at(12))[0].end, at(11, 13));
});

test('an update or delete with an id that is not valid is refused', () => {
  assert.equal(L.updateLocalEvent({ id: 'nope', title: 'x' }).status, 'error');
  assert.equal(L.deleteLocalEvent('../../etc').status, 'error');
  assert.equal(L.deleteLocalEvent(42).status, 'error');
});

test('a calendar file that cannot be read refuses changes and is not overwritten', () => {
  fs.writeFileSync(L.FILE, '{ not json');
  assert.equal(L.addLocalEvent(ev('Blocked', at(10, 9), at(10, 10))).status, 'error');
  assert.equal(fs.readFileSync(L.FILE, 'utf8'), '{ not json');
  assert.deepEqual(L.localEventsBetween(at(10), at(11)), []);
});
