// Weekly repeats: a week starts on WKST, so an every-2-weeks rule on Sunday and Monday gives the right days. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { occurrences, parseIcs } from '../src/apps/calendar/server/ics.ts';

const DAY = 86_400_000;
const base = new Date(2026, 8, 6).getTime();   // a Sunday
assert.equal(new Date(base).getDay(), 0);

/** Days after the start for each occurrence, for a rule with the given extra parts. */
function offsets(extra: string): number[] {
  const text = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260906', `RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO${extra}`, 'SUMMARY:Standup', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const from = new Date(2026, 8, 1).getTime(), to = new Date(2027, 0, 1).getTime();
  return occurrences(parseIcs(text), from, to).map(o => Math.round((new Date(o.start).getTime() - base) / DAY));
}

test('every 2 weeks on Sunday and Monday, with the week starting on Sunday (WKST=SU)', () => {
  assert.deepEqual(offsets(';WKST=SU;COUNT=4'), [0, 1, 14, 15]);
});

test('without WKST the week starts on Monday, as before', () => {
  assert.deepEqual(offsets(';COUNT=4'), [0, 8, 14, 22]);
});

test('with every week (INTERVAL 1), the week start does not change the days', () => {
  const text = (wkst: string) => ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260906', `RRULE:FREQ=WEEKLY;BYDAY=SU,MO;${wkst}COUNT=4`, 'SUMMARY:Daily', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const days = (t: string) => occurrences(parseIcs(t), new Date(2026, 8, 1).getTime(), new Date(2027, 0, 1).getTime()).map(o => Math.round((new Date(o.start).getTime() - base) / DAY));
  assert.deepEqual(days(text('WKST=SU;')), [0, 1, 7, 8]);
  assert.deepEqual(days(text('WKST=MO;')), [0, 1, 7, 8]);
});
