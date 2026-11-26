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

function monthlyOccurrences(rrule: string, from: number, to: number) {
  const text = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261001', `RRULE:${rrule}`, 'SUMMARY:Work', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return occurrences(parseIcs(text), from, to).map(o => new Date(o.start));
}

test('BYSETPOS=-1 on the weekdays of a month gives only the last weekday', () => {
  const from = new Date(2026, 9, 1).getTime(), to = new Date(2026, 10, 1).getTime();
  const occ = monthlyOccurrences('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', from, to);
  assert.equal(occ.length, 1);
  assert.equal(occ[0].getFullYear(), 2026);
  assert.equal(occ[0].getMonth(), 9);
  assert.equal(occ[0].getDate(), 30);
  assert.equal(occ[0].getDay(), 5);
});

test('BYSETPOS=1 on the weekdays of a month gives the first weekday', () => {
  const from = new Date(2026, 9, 1).getTime(), to = new Date(2026, 10, 1).getTime();
  const occ = monthlyOccurrences('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1', from, to);
  assert.equal(occ.length, 1);
  assert.equal(occ[0].getDate(), 1);
  assert.equal(occ[0].getDay(), 4);
});

test('BYSETPOS=-1 with COUNT=2 stops after two months', () => {
  const from = new Date(2026, 0, 1).getTime(), to = new Date(2027, 0, 1).getTime();
  const occ = monthlyOccurrences('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=2', from, to);
  assert.deepEqual(occ.map(d => [d.getMonth(), d.getDate()]), [[9, 30], [10, 30]]);
});

test('a monthly weekday rule without BYSETPOS still lists every weekday', () => {
  const from = new Date(2026, 9, 1).getTime(), to = new Date(2026, 10, 1).getTime();
  const occ = monthlyOccurrences('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR', from, to);
  assert.equal(occ.length, 22);
  assert.deepEqual(occ.map(d => d.getDate()).slice(0, 3), [1, 2, 5]);
  assert.equal(occ[occ.length - 1].getDate(), 30);
});
