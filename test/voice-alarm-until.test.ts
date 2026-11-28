// "How long until my alarm" by voice (src/core/web/voice-alarm.ts; the reply is in voice-commands.ts, read as source).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { alarmUntilSay, alarmUntilWord } from '../src/core/web/voice-alarm.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const clock = readFileSync(new URL('../src/apps/clock/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('"how long until my alarm" and "how much sleep do I get" are matched, with the common variants', () => {
  assert.equal(alarmUntilWord('how long until my alarm'), true);
  assert.equal(alarmUntilWord('how long till my alarm goes off'), true);
  assert.equal(alarmUntilWord('how long til my alarm rings'), true);
  assert.equal(alarmUntilWord('how much sleep do i get'), true);
});

test('"when is my alarm" and other alarm questions are not the time-left question', () => {
  assert.equal(alarmUntilWord("when's my alarm"), false);
  assert.equal(alarmUntilWord('how long until lunch'), false);
  assert.equal(alarmUntilWord('how long is left on the timer'), false);
});

test('the reply gives the time left to the minute, from the next alarm’s ring time', () => {
  assert.ok(voice.includes('if (alarmUntilWord(t)) {'));
  assert.ok(voice.includes('return { say: alarmUntilSay(n.at, Date.now(), clockText(n.h, n.m), n.when), react: \'look\' };'));
  assert.ok(voice.includes("'You don’t have any alarms on.'"));
});

test('the Clock passes the ring time through to voice', () => {
  assert.ok(clock.includes('when: whenWord(n.at), at: n.at }'));
});

test('under a day it counts in hours and minutes; a day or more away it names the day and the count of days', () => {
  const now = Date.parse('2026-11-30T09:00:00');
  assert.equal(alarmUntilSay(now + 20 * 60e3, now, '9:20 AM', 'today'), 'Your alarm goes off in 20 minutes.');
  assert.equal(alarmUntilSay(now + 24 * 3600e3, now, '9:00 AM', 'tomorrow'), 'Your next alarm is 9:00 AM tomorrow, in 1 day.');
  assert.equal(alarmUntilSay(now + 5 * 24 * 3600e3, now, '7:00 AM', 'next Saturday'), 'Your next alarm is 7:00 AM next Saturday, in 5 days.');
  assert.equal(alarmUntilSay(now + 10e3, now, '9:00 AM', 'today'), 'Your alarm goes off in under a minute.');
});
