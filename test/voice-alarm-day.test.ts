// "Do I have an alarm on Saturday" by voice (src/core/web/voice-alarm.ts; the reply is in voice-commands.ts, read as source).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { alarmDayWord } from '../src/core/web/voice-alarm.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('an alarm question for a named weekday gives that weekday’s number (Sunday is 0)', () => {
  assert.equal(alarmDayWord('do i have an alarm on saturday'), 6);
  assert.equal(alarmDayWord('is there an alarm for monday'), 1);
  assert.equal(alarmDayWord('have i got an alarm set for sunday'), 0);
});

test('tomorrow, and other phrases, are not a named-day alarm question', () => {
  assert.equal(alarmDayWord('do i have an alarm tomorrow'), null);
  assert.equal(alarmDayWord('do i have an alarm on funday'), null);
  assert.equal(alarmDayWord('what time is the alarm on saturday'), null);
});

test('the reply checks the alarms that ring that day and says the earliest, or that there is none', () => {
  assert.ok(voice.includes('const alarmDay = alarmDayWord(t);'));
  assert.ok(voice.includes('`Yes, your alarm is at ${clockText(rings[0].h, rings[0].m)} on ${name}.`'));
  assert.ok(voice.includes('`You don’t have an alarm on ${name}.`'));
});
