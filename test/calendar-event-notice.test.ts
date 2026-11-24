// The "starts soon" calendar notice (src/apps/calendar/web/event-notice.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CalEvent } from '../src/apps/calendar/api.ts';
import { dueNotices, eventKey, noticeText, NOTICE_LEAD_MS, pruneNotified } from '../src/apps/calendar/web/event-notice.ts';

const START = Date.parse('2026-11-24T14:00:00');
const at = (ms: number): string => new Date(ms).toISOString();
const timed = (title: string, start = START, extra: Partial<CalEvent> = {}): CalEvent =>
  ({ title, start: at(start), end: at(start + 30 * 60e3), allDay: false, day: 'today', ...extra });

test('a timed event is due inside the lead time, and not before or after it', () => {
  const e = timed('Dentist');
  assert.equal(dueNotices([e], START - NOTICE_LEAD_MS - 1, {}).length, 0);
  assert.equal(dueNotices([e], START - NOTICE_LEAD_MS, {}).length, 1);
  assert.equal(dueNotices([e], START - 1, {}).length, 1);
  assert.equal(dueNotices([e], START, {}).length, 0);   // it has started: no late notice
});

test('an event already told is not told again, and all-day events never are', () => {
  const e = timed('Dentist');
  const told = { [eventKey(e)]: START };
  assert.equal(dueNotices([e], START - 60e3, told).length, 0);
  assert.equal(dueNotices([timed('Holiday', START, { allDay: true })], START - 60e3, {}).length, 0);
});

test('a moved event is told again: the key has the start and the title', () => {
  const told = { [eventKey(timed('Dentist'))]: START };
  const moved = timed('Dentist', START + 60 * 60e3);
  assert.equal(dueNotices([moved], START + 60 * 60e3 - 60e3, told).length, 1);
});

test('a record older than a day is dropped; a recent one stays', () => {
  const now = START + 48 * 3600e3;
  const told = { old: START, recent: now - 3600e3 };
  assert.deepEqual(pruneNotified(told, now), { recent: now - 3600e3 });
});

test('the notice names the event, its start and its place', () => {
  assert.deepEqual(noticeText(timed('Dentist', START, { location: 'Main St' }), '2:00 PM'),
    { title: 'Coming up: Dentist', body: 'Starts at 2:00 PM · Main St' });
  assert.deepEqual(noticeText(timed('Dentist'), '2:00 PM'), { title: 'Coming up: Dentist', body: 'Starts at 2:00 PM' });
});
