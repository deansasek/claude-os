// "Turn on my 7 am alarm" switches that alarm back on (src/core/web/voice-alarm.ts, voice-commands.ts, src/apps/clock/web/index.ts).
// The Clock needs the browser, so the voice and the Clock are read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { alarmOnTimePhrase, alarmTimePhrase } from '../src/core/web/voice-alarm.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const clock = readFileSync(new URL('../src/apps/clock/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('turn on, switch on and switch back on name the time of an alarm', () => {
  assert.equal(alarmOnTimePhrase('turn on my 7 am alarm'), '7 am');
  assert.equal(alarmOnTimePhrase('switch on the 6 30 alarm'), '6 30');
  assert.equal(alarmOnTimePhrase('switch my 6 30 alarm back on'), '6 30');
});

test('an on phrase with no time is not a time, and the off phrase is unchanged', () => {
  assert.equal(alarmOnTimePhrase('turn on my alarm'), null);
  assert.equal(alarmOnTimePhrase('turn on the kitchen light'), null);
  assert.equal(alarmTimePhrase('turn off my 7 am alarm'), '7 am');
});

test('the voice switches the alarms at that time on, and the Clock keeps their days', () => {
  assert.match(voice, /const n = clock\.switchOnAlarm\(h, m\);/);
  assert.match(voice, /return \{ say: n \? `Okay, your \$\{clockText\(h, m\)\} alarm is on\.` : `You don’t have an alarm at \$\{clockText\(h, m\)\}\.`, react: 'hop' \};/);
  assert.match(clock, /switchOnAlarm\(h: number, m: number\): number \{/);
  assert.match(clock, /if \(!a\.on\) \{ a\.on = true; a\.snooze = null; arm\(a\); \}/);
});
