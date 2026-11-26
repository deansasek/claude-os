// The words on Home's Today (calendar) tile (src/apps/home/web/calendar-row.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarRow, connectorCalAfterRead } from '../src/apps/home/web/calendar-row.ts';

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

test('a stale PC copy says May be out of date before the events', () => {
  const cal = { status: 'ok', stale: true, events: [{ title: 'Review', start: '2026-11-26T14:00:00', end: '2026-11-26T15:00:00', allDay: true, day: 'today' as const }] };
  const row = calendarRow(cal, false, false, NOW);
  assert.equal(row.val, 'Review (all day)');
  assert.equal(row.sub, 'May be out of date · Nothing else today');
});

test('a stale PC copy with nothing left today keeps the prefix on the tomorrow line', () => {
  const cal = { status: 'ok', stale: true, events: [{ title: 'Standup', start: '2026-11-27T09:00:00', end: '2026-11-27T09:30:00', allDay: false, day: 'tomorrow' as const }] };
  const row = calendarRow(cal, false, false, NOW);
  assert.equal(row.val, 'A free day');
  assert.ok(row.sub.startsWith('May be out of date · Tomorrow: '), row.sub);
});

test('a failed read with no events still says Offline, not May be out of date', () => {
  const cal = { status: 'ok', stale: true, events: [{ title: 'Review', start: '2026-11-26T14:00:00', end: '2026-11-26T15:00:00', allDay: true, day: 'today' as const }] };
  const row = calendarRow(cal, true, false, NOW);
  assert.equal(row.sub, 'Offline · Nothing else today');
});

test('cal null with failed false and miss false still reads', () => {
  assert.deepEqual(calendarRow(null, false, false, NOW), { cls: 'quiet', val: '–', sub: 'Reading the calendar…' });
});

const TODAY = '2026-11-26';
const earlierRead = {
  status: 'ok' as const,
  events: [{ title: 'Review', start: '2026-11-26T14:00:00', end: '2026-11-26T15:00:00', allDay: true, day: 'today' as const }],
};

test('a connector miss on the same day keeps the earlier events, marked stale', () => {
  const res = connectorCalAfterRead(earlierRead, TODAY, { status: 'miss' }, { status: 'ok', events: [] }, TODAY);
  assert.equal(res.miss, false);
  assert.equal(res.failed, false);
  assert.equal(res.day, TODAY);
  const row = calendarRow(res.cal, res.failed, res.miss, NOW);
  assert.equal(row.val, 'Review (all day)');
  assert.equal(row.sub, 'May be out of date · Nothing else today');
});

test('a connector miss on a different day gives Not read yet', () => {
  const res = connectorCalAfterRead(earlierRead, '2026-11-25', { status: 'miss' }, { status: 'miss' }, TODAY);
  assert.equal(res.cal, null);
  assert.equal(res.miss, true);
  assert.equal(res.day, null);
  assert.deepEqual(calendarRow(res.cal, res.failed, res.miss, NOW), { cls: 'quiet', val: 'Not read yet', sub: 'Open Calendar to read it' });
});

test('a connector ok answer uses the new events and records the day read', () => {
  const dentist = { title: 'Dentist', start: Date.parse('2026-11-26T16:00:00'), end: Date.parse('2026-11-26T16:30:00'), allDay: false };
  const res = connectorCalAfterRead(earlierRead, TODAY, { status: 'ok', events: [dentist] }, { status: 'ok', events: [] }, TODAY);
  assert.equal(res.miss, false);
  assert.equal(res.failed, false);
  assert.equal(res.day, TODAY);
  assert.equal(res.cal?.events.length, 1);
  assert.equal(res.cal?.events[0].title, 'Dentist');
  assert.equal(res.cal?.stale, undefined);
  assert.ok(calendarRow(res.cal, res.failed, res.miss, NOW).val.endsWith(' Dentist'));
});
