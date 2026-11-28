// "How long until my alarm" by voice (src/core/web/voice-alarm.ts; the reply is in voice-commands.ts, read as source).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { alarmUntilWord } from '../src/core/web/voice-alarm.ts';

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
  assert.ok(voice.includes('const mins = Math.round((n.at - Date.now()) / 60000);'));
  assert.ok(voice.includes('`Your alarm goes off in ${sayDuration(mins * 60000)}.`'));
  assert.ok(voice.includes("'You don’t have any alarms on.'"));
});

test('the Clock passes the ring time through to voice', () => {
  assert.ok(clock.includes('when: whenWord(n.at), at: n.at }'));
});
