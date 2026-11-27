// An all-day repeat that ends on a UTC UNTIL keeps the last day, also west of UTC (src/apps/calendar/server/ics.ts untilMs).
// Run with: npm test
process.env.TZ = 'America/New_York';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { occurrences, parseIcs } from '../src/apps/calendar/server/ics.ts';

/** The day numbers in December 2026 on which the rule repeats. */
function days(dtstart: string, rrule: string): number[] {
  const text = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', dtstart, `RRULE:${rrule}`, 'SUMMARY:Camp', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const from = new Date(2026, 11, 1).getTime(), to = new Date(2027, 0, 1).getTime();
  return occurrences(parseIcs(text), from, to).map(o => new Date(o.start).getDate());
}

test('an all-day daily series ends on the UTC UNTIL day, not the day before', () => {
  assert.deepEqual(days('DTSTART;VALUE=DATE:20261201', 'FREQ=DAILY;UNTIL=20261204T000000Z'), [1, 2, 3, 4]);
});

test('an all-day daily series ends on a date-only UNTIL day', () => {
  assert.deepEqual(days('DTSTART;VALUE=DATE:20261201', 'FREQ=DAILY;UNTIL=20261204'), [1, 2, 3, 4]);
});

test('a timed daily series with a UTC UNTIL still ends at that instant', () => {
  assert.deepEqual(days('DTSTART:20261201T090000Z', 'FREQ=DAILY;UNTIL=20261204T000000Z'), [1, 2, 3]);
});
