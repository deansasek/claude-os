// Calendar times in their own time zone (TZID). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { occurrences, parseIcs } from '../src/apps/calendar/server/ics.ts';

/** The start of a one-off event written with a TZID, in UTC ms. */
function startOf(tzid: string, local: string): number {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:z', 'SUMMARY:Zone',
    `DTSTART;TZID=${tzid}:${local}`, `DTEND;TZID=${tzid}:${local.replace('T1000', 'T1100')}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const from = Date.UTC(2025, 0, 1), to = Date.UTC(2027, 0, 1);
  const out = occurrences(parseIcs(ics), from, to);
  assert.equal(out.length, 1, `one occurrence for ${tzid}`);
  return out[0].start;
}

test('a New York time in winter is five hours ahead of UTC', () => {
  assert.equal(startOf('America/New_York', '20260101T100000'), Date.UTC(2026, 0, 1, 15, 0, 0));
});

test('a Windows zone name gives the same time as its IANA zone', () => {
  assert.equal(startOf('Eastern Standard Time', '20260101T100000'), Date.UTC(2026, 0, 1, 15, 0, 0));
});

test('a Berlin time in summer is two hours ahead of UTC (daylight saving)', () => {
  assert.equal(startOf('Europe/Berlin', '20260701T100000'), Date.UTC(2026, 6, 1, 8, 0, 0));
});

test('London in winter matches UTC', () => {
  assert.equal(startOf('Europe/London', '20260101T100000'), Date.UTC(2026, 0, 1, 10, 0, 0));
});

test('an unknown zone is read as the PC local time, as before', () => {
  assert.equal(startOf('Mars/Olympus', '20260101T100000'), new Date(2026, 0, 1, 10, 0, 0).getTime());
});
