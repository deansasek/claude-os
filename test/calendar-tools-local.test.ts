// Claude's calendar tools include the events the user added on the ClaudeOS calendar (src/apps/calendar/server/tools.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarRangeReply, calendarTodayReply } from '../src/apps/calendar/server/tools.ts';

const now = new Date(2026, 10, 28, 9, 0);   // Saturday 28 November 2026, 09:00
const ev = (title: string, h: number, day = 0) => ({ id: title, title, start: new Date(2026, 10, 28 + day, h).getTime(), end: new Date(2026, 10, 28 + day, h + 1).getTime(), allDay: false, calendar: 'claudeos' });
const notSet = async () => ({ status: 'not_set', events: [], today: '2026-11-28' }) as never;

test('today shows a ClaudeOS event when no ICS calendar is set', async () => {
  const r = await calendarTodayReply('today', notSet, () => [ev('Dentist', 10)] as never, now);
  assert.match(r.content[0].text, /Dentist/);
  assert.doesNotMatch(r.content[0].text, /No calendar is set up yet/);
});

test('no calendar and no ClaudeOS events says no calendar is set up; an unreadable ClaudeOS calendar is said', async () => {
  const none = await calendarTodayReply('today', notSet, () => [] as never, now);
  assert.match(none.content[0].text, /No calendar is set up yet/);
  const unread = await calendarTodayReply('today', notSet, () => null, now);
  assert.match(unread.content[0].text, /ClaudeOS calendar couldn’t be read/);
});

test('a range includes the ClaudeOS events when no ICS calendar is set', async () => {
  const r = await calendarRangeReply({ days: 3 }, async () => ({ status: 'not_set', events: [] }) as never, () => [ev('Cinema', 19, 1)] as never, now);
  assert.match(r.content[0].text, /Cinema/);
  assert.doesNotMatch(r.content[0].text, /No calendar is set up yet/);
});
