// The words on Home's Today (calendar) tile (src/apps/home/web/calendar-row.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarRow } from '../src/apps/home/web/calendar-row.ts';

const NOW = Date.parse('2026-11-26T12:00:00');

test('a failed read with no events says the PC cannot be reached, even after a miss', () => {
  assert.deepEqual(calendarRow(null, true, false, NOW), { cls: 'quiet', val: 'Can’t read it', sub: 'Can’t reach the PC' });
  assert.deepEqual(calendarRow(null, true, true, NOW), { cls: 'quiet', val: 'Can’t read it', sub: 'Can’t reach the PC' });
});

test('a miss with no events says the calendar is not read yet', () => {
  assert.deepEqual(calendarRow(null, false, true, NOW), { cls: 'quiet', val: 'Not read yet', sub: 'Open Calendar to read it' });
});

test('calendar events show the next event with its time', () => {
  const cal = {
    status: 'ok',
    events: [
      { title: 'Standup', start: '2026-11-26T09:00:00', end: '2026-11-26T09:30:00', allDay: false, day: 'today' as const },
      { title: 'Review', start: '2026-11-26T14:00:00', end: '2026-11-26T15:00:00', allDay: false, day: 'today' as const },
      { title: 'Dentist', start: '2026-11-26T16:00:00', end: '2026-11-26T16:30:00', allDay: false, day: 'today' as const },
      { title: 'Lunch', start: '2026-11-26T11:00:00', end: '2026-11-26T11:30:00', allDay: false, day: 'today' as const },
    ],
  };
  const row = calendarRow(cal, false, false, NOW);
  assert.equal(row.cls, 'hm-ntitle');
  assert.ok(row.val.endsWith(' Review'), row.val);
  assert.ok(row.sub.endsWith('Dentist'), row.sub);
  assert.ok(!row.sub.includes('Standup') && !row.sub.includes('Lunch'), row.sub);
});

test('a failed read with old events says Offline before the events', () => {
  const cal = { status: 'ok', events: [{ title: 'Review', start: '2026-11-26T14:00:00', end: '2026-11-26T15:00:00', allDay: true, day: 'today' as const }] };
  const row = calendarRow(cal, true, false, NOW);
  assert.equal(row.val, 'Review (all day)');
  assert.equal(row.sub, 'Offline · Nothing else today');
});

test('cal null with failed false and miss false still reads', () => {
  assert.deepEqual(calendarRow(null, false, false, NOW), { cls: 'quiet', val: '–', sub: 'Reading the calendar…' });
});
