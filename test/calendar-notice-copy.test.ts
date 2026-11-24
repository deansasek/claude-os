// The tablet's copy of the calendar events, used for notices while the PC is off (src/apps/calendar/web/event-notice.ts).
// A copy older than COPY_MAX_MS is not used. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyUsable, COPY_MAX_MS, noticeText, parseCopy } from '../src/apps/calendar/web/event-notice.ts';

const READ = Date.parse('2026-11-24T09:00:00');

test('a copy read within the age limit is used; one older than it is not', () => {
  assert.equal(copyUsable(READ, READ), true);
  assert.equal(copyUsable(READ, READ + COPY_MAX_MS), true);
  assert.equal(copyUsable(READ, READ + COPY_MAX_MS + 1), false);
});

test('a saved copy that is missing or malformed is not read', () => {
  assert.equal(parseCopy(null), null);
  assert.equal(parseCopy('not json'), null);
  assert.equal(parseCopy(JSON.stringify({ events: [] })), null);            // no read time
  assert.equal(parseCopy(JSON.stringify({ readAt: READ, events: {} })), null);  // events not a list
  assert.deepEqual(parseCopy(JSON.stringify({ readAt: READ, events: [] })), { readAt: READ, events: [] });
});

test('a notice from a copy says when the PC read the calendar', () => {
  const e = { title: 'Dentist', start: '2026-11-24T14:00:00.000Z', end: '2026-11-24T14:30:00.000Z', allDay: false, day: 'today' as const };
  assert.deepEqual(noticeText(e, '2:00 PM', '9:00 AM'),
    { title: 'Coming up: Dentist', body: 'Starts at 2:00 PM · from a copy read at 9:00 AM' });
});
