// Claude's calendar_add tool puts an event on the ClaudeOS calendar through addLocalEvent (src/apps/calendar/server/tools.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { calendarAddReply, eventWindow } from '../src/apps/calendar/server/tools.ts';

const fake = (calls: unknown[]) => ((input: unknown) => { calls.push(input); return { status: 'ok', event: input }; }) as never;

test('a timed event goes on the ClaudeOS calendar with its start and end on the date', () => {
  const calls: any[] = [];
  const r = calendarAddReply({ title: 'Dentist', date: '2026-12-03', start: '10:00', end: '11:30', location: 'High St' }, fake(calls));
  assert.match(r.content[0].text, /^Added “Dentist” on Thursday.*10:00.*11:30/);
  assert.equal(calls[0].title, 'Dentist');
  assert.equal(calls[0].allDay, false);
  assert.equal(calls[0].end - calls[0].start, 90 * 60e3);
  assert.equal(calls[0].location, 'High St');
});

test('a day with no start, or allDay, is a whole-day event; a bad time or date is refused without adding', () => {
  const calls: any[] = [];
  const day = calendarAddReply({ title: 'Holiday', date: '2026-12-25', allDay: true }, fake(calls));
  assert.match(day.content[0].text, /all day/);
  assert.equal(calls[0].allDay, true);
  const bad = calendarAddReply({ title: 'X', date: '2026-02-30' }, fake(calls));
  assert.equal(bad.isError, true);
  const backwards = calendarAddReply({ title: 'X', date: '2026-12-03', start: '11:00', end: '10:00' }, fake(calls));
  assert.match(backwards.content[0].text, /not after the start/);
  assert.equal(calls.length, 1);
});

test('the window keeps the day and the times, and the card shows the date and time', () => {
  const w = eventWindow('2026-12-03', '09:00');
  assert.ok(!('error' in w));
  assert.equal((w as { end: number }).end - (w as { start: number }).start, 3600e3);
  const describe = readFileSync(new URL('../src/apps/claude/server/describe.ts', import.meta.url), 'utf8');
  const cards = readFileSync(new URL('../src/apps/claude/web/tools.ts', import.meta.url), 'utf8');
  assert.ok(describe.includes("if (n === 'calendar_add' && typeof i.title === 'string' && typeof i.date === 'string')"));
  assert.ok(cards.includes("'mcp__claudeos_calendar__calendar_add': { now: 'Add to your calendar', past: 'Added to your calendar', doing: 'Adding to your calendar' },"));
});
