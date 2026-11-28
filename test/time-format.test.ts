// The 24-hour time setting for the Clock app, Home and its Today tile (src/core/web/time-format.ts, src/apps/home/web).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { hourMinuteFormat } from '../src/core/web/time-format.ts';
import { calendarRow } from '../src/apps/home/web/calendar-row.ts';

const hourOf = (f: Intl.DateTimeFormat, d: Date): string => f.formatToParts(d).find(p => p.type === 'hour')?.value ?? '';
const at13 = new Date(2026, 0, 1, 13, 5);

test('the 24-hour setting shows 13 o’clock as 13, and the 12-hour setting as 1', () => {
  assert.equal(hourOf(hourMinuteFormat('1'), at13), '13');
  assert.equal(hourOf(hourMinuteFormat('0'), at13), '1');
  assert.equal(hourMinuteFormat('1').resolvedOptions().hour12, false);
  assert.equal(hourMinuteFormat('0').resolvedOptions().hour12, true);
});

test('an unset setting follows the locale, as before', () => {
  assert.equal(hourMinuteFormat(null).resolvedOptions().hour12, new Intl.DateTimeFormat([], { hour: 'numeric' }).resolvedOptions().hour12);
});

test('the Today tile follows the 24-hour setting for an event time', () => {
  const start = new Date(2026, 0, 1, 13, 30).getTime();
  const cal = { status: 'ok', events: [{ title: 'Dentist', start: new Date(start).toISOString(), end: new Date(start + 3600e3).toISOString(), allDay: false, day: 'today' as const }] };
  const now = new Date(2026, 0, 1, 9, 0).getTime();
  assert.ok(calendarRow(cal, false, false, now, '1').val.includes('13:30'));
  assert.ok(calendarRow(cal, false, false, now, '0').val.includes('1:30'));
});

test('the Clock app and Home read the setting, not a fixed locale format', () => {
  const clock = readFileSync(new URL('../src/apps/clock/web/index.ts', import.meta.url), 'utf8');
  const home = readFileSync(new URL('../src/apps/home/web/index.ts', import.meta.url), 'utf8');
  assert.ok(clock.includes("hourMinuteFormat(store.get('os.clock24')).formatToParts(d)"));
  assert.ok(home.includes("hourMinuteFormat(store.get('os.clock24')).formatToParts(d)"));
  assert.ok(home.includes("calendarRow(cal, calFailed, calMiss, now().getTime(), store.get('os.clock24'))"));
});
