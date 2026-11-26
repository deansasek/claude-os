// The Calendar app's calendar selector: the shown flags (kept on the PC), what is drawn when a calendar is hidden,
// and the calendar id each event carries. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { calendarsFor, flagsOf, isShown, tagCalendar, visibleEvents, type CalendarInfo } from '../src/apps/calendar/web/calendars.ts';

// The stores read their file paths when they load, so the scratch files are set before the imports.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-cal-sel-'));
process.env.CLAUDEOS_CALENDAR_SHOWN_FILE = path.join(dir, 'calendar-shown.json');
process.env.CLAUDEOS_CALENDAR_LOCAL_FILE = path.join(dir, 'calendar-local.json');
const S = await import('../src/apps/calendar/server/calendar-shown.ts');
const L = await import('../src/apps/calendar/server/local.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => { fs.rmSync(S.FILE, { force: true }); fs.rmSync(L.FILE, { force: true }); });

const at = (d: number, h = 0): number => new Date(2026, 10, d, h).getTime();   // November 2026, local time
const named = (list: CalendarInfo[]) => Object.fromEntries(list.map(c => [c.id, c.shown]));

test('every calendar is shown until it is stored as hidden', () => {
  assert.deepEqual(named(calendarsFor(true, {})), { claudeos: true, ics: true });
  assert.deepEqual(named(calendarsFor(false, {})), { claudeos: true, connector: true });
  assert.deepEqual(S.loadFlags(), {}, 'no file means no stored flags');
  assert.equal(isShown({}, 'ics'), true);
  assert.equal(isShown({}, undefined), true, 'an event with no calendar id is drawn');
});

test('a shown flag is saved on the PC and read back; only known ids are kept', () => {
  const r = S.setShown('ics', false, true);
  assert.equal(r.status, 'ok');
  assert.deepEqual(named(r.status === 'ok' ? r.calendars : []), { claudeos: true, ics: false });
  assert.deepEqual(S.loadFlags(), { ics: false });
  const bad = S.setShown('google-work', false, true);
  assert.equal(bad.status, 'error');
  assert.equal(S.setShown('claudeos', 'no', true).status, 'error', 'the flag must be true or false');
  assert.equal(fs.existsSync(S.FILE), true);
  assert.deepEqual(S.loadFlags(), { ics: false }, 'a refused change leaves the file as it was');
});

test('a shown file that cannot be read is not saved over', () => {
  fs.writeFileSync(S.FILE, 'not json {{');
  const before = fs.readFileSync(S.FILE);
  const r = S.setShown('ics', false, true);
  assert.equal(r.status, 'error');
  assert.deepEqual(fs.readFileSync(S.FILE), before, 'the unreadable file keeps its bytes');
});

test('a missing shown file is created on the first save', () => {
  assert.equal(fs.existsSync(S.FILE), false);
  const r = S.setShown('ics', false, true);
  assert.equal(r.status, 'ok');
  assert.deepEqual(S.loadFlags(), { ics: false });
});

test('hiding a calendar removes its events from the drawn range', () => {
  const local = L.addLocalEvent({ title: 'Dentist', start: at(10, 9), end: at(10, 10), allDay: false });
  assert.equal(local.status, 'ok');
  const ics = tagCalendar([{ title: 'School run', start: at(10, 8), end: at(10, 8) + 30 * 60e3, allDay: false }], 'ics');
  const from = at(10), to = at(11);
  const inRange = [...L.localEventsBetween(from, to), ...ics];
  assert.deepEqual(visibleEvents(inRange, flagsOf(calendarsFor(true, {}))).map(e => e.title).sort(), ['Dentist', 'School run']);

  S.setShown('ics', false, true);
  const flags = flagsOf(calendarsFor(true, S.loadFlags()));
  assert.deepEqual(visibleEvents(inRange, flags).map(e => e.title), ['Dentist'], 'the hidden calendar draws nothing');

  S.setShown('ics', true, true);
  S.setShown('claudeos', false, true);
  const flags2 = flagsOf(calendarsFor(true, S.loadFlags()));
  assert.deepEqual(visibleEvents(inRange, flags2).map(e => e.title), ['School run'], 'ClaudeOS can be hidden too');
});

test('each event carries its calendar id', () => {
  const r = L.addLocalEvent({ title: 'Dentist', start: at(10, 9), end: at(10, 10), allDay: false });
  assert.equal(r.status, 'ok');
  const local = L.localEventsBetween(at(10), at(11));
  assert.ok(local.length === 1 && local.every(e => e.calendar === 'claudeos'));

  const ext = tagCalendar([{ title: 'Pickup', start: at(12, 15), end: at(12, 16), allDay: false }], 'ics');
  assert.equal(ext[0].calendar, 'ics');
  assert.equal(ext[0].title, 'Pickup', 'the other fields are kept as they were');
  const conn = tagCalendar([{ title: 'Lunch', start: at(12, 12), end: at(12, 13), allDay: false }], 'connector');
  assert.equal(conn[0].calendar, 'connector');
});
