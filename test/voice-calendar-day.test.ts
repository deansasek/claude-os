// Calendar on a named weekday by voice (src/core/web/voice-calendar.ts; the read is in voice-commands.ts, read as source).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { calendarDay, calendarDaySay } from '../src/core/web/voice-calendar.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a weekday means its next day, and today’s own weekday is today', () => {
  // today is Wednesday (3)
  assert.deepEqual(calendarDay("what's on saturday", 3), { ahead: 3, name: 'on Saturday' });
  assert.deepEqual(calendarDay('do i have anything on wednesday', 3), { ahead: 0, name: 'on Wednesday' });
  assert.deepEqual(calendarDay("what's on my calendar on friday", 3), { ahead: 2, name: 'on Friday' });
  assert.deepEqual(calendarDay('what have i got on sunday', 3), { ahead: 4, name: 'on Sunday' });
});

test('today, tomorrow and other questions are not weekday calendar questions', () => {
  assert.equal(calendarDay("what's on tomorrow", 3), null);
  assert.equal(calendarDay("what's on today", 3), null);
  assert.equal(calendarDay("what's on funday", 3), null);
  assert.equal(calendarDay("what's for dinner on friday", 3), null);
});

test('the reply lists up to three events for that day, or says nothing is on', () => {
  assert.equal(calendarDaySay([], 'on Saturday'), 'Nothing on your calendar on Saturday.');
  assert.equal(calendarDaySay(['Dentist at 9:00 AM'], 'on Saturday'), 'On Saturday: Dentist at 9:00 AM.');
  assert.equal(calendarDaySay(['Dentist at 9:00 AM', 'Parents, all day'], 'on Saturday'), 'On Saturday: Dentist at 9:00 AM; and Parents, all day.');
  assert.equal(calendarDaySay(['a', 'b', 'c', 'd'], 'on Friday'), 'On Friday: a; b; and c.');
});

test('the weekday question reads the local calendar for that one day', () => {
  assert.ok(voice.includes('calendarDay(t)'));
  assert.ok(voice.includes('/api/calendar/local?from=${isoDay(start)}&to=${isoDay(end)}'));
});
