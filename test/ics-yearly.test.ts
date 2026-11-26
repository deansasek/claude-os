// Yearly repeats with a month and a weekday (Outlook's "the second Sunday of May"): the occurrence lands on that day.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { occurrences, parseIcs } from '../src/apps/calendar/server/ics.ts';

test('a yearly repeat on the second Sunday of May lands on that Sunday', () => {
  const text = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20250511', 'RRULE:FREQ=YEARLY;BYMONTH=5;BYDAY=2SU', 'SUMMARY:Mother', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const from = new Date(2026, 4, 1).getTime(), to = new Date(2026, 5, 1).getTime();
  const occ = occurrences(parseIcs(text), from, to);
  assert.equal(occ.length, 1);
  const d = new Date(occ[0].start);
  assert.equal(d.getMonth(), 4);
  assert.equal(d.getDate(), 10);
  assert.equal(d.getDay(), 0);
});
