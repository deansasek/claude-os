// The Calendar mock: the ClaudeOS calendar adds, edits and deletes events for the session; the events read shows
// today and tomorrow; the calendar selector and the connector answer. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerMock } from '../src/core/web/mock-api.ts';
import '../src/apps/calendar/web/mock.ts';

test('the events read lists today and tomorrow, with the day of each', () => {
  const r = answerMock('GET', '/api/calendar/events').body as { status: string; events: { day: string; title: string }[] };
  assert.equal(r.status, 'ok');
  assert.ok(r.events.some(e => e.day === 'today'));
  assert.ok(r.events.some(e => e.day === 'tomorrow'));
});

test('a ClaudeOS event can be added, edited and deleted, and each change shows in the range read', () => {
  const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10).getTime(), end = start + 3600e3;
const pad = (n: number) => String(n).padStart(2, '0');
const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
const dayAfter = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
  const added = answerMock('POST', '/api/calendar/local-add', { title: 'Mock test', start, end, allDay: false }).body as { status: string; event: { id: string } };
  assert.equal(added.status, 'ok');
  const range = (q: string) => answerMock('GET', '/api/calendar/range', null, q).body as { events: { id?: string; title: string }[] };
  assert.ok(range(`from=${day}&to=${dayAfter}`).events.some(e => e.title === 'Mock test'));
  answerMock('POST', '/api/calendar/local-update', { id: added.event.id, title: 'Renamed' });
  assert.ok(range(`from=${day}&to=${dayAfter}`).events.some(e => e.title === 'Renamed'));
  assert.deepEqual(answerMock('POST', '/api/calendar/local-delete', { id: added.event.id }).body, { status: 'ok', removed: 1 });
});

test('an event with no title or an end before its start is refused', () => {
  assert.equal((answerMock('POST', '/api/calendar/local-add', { title: '', start: 1, end: 2 }).body as { status: string }).status, 'error');
  assert.equal((answerMock('POST', '/api/calendar/local-add', { title: 'x', start: 5, end: 2 }).body as { status: string }).status, 'error');
});
