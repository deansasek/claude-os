// "Wake me up in 30 minutes" by voice (src/core/web/voice-alarm.ts; the alarm is set in voice-commands.ts, read as source).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { alarmInMs } from '../src/core/web/voice-alarm.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a time from now is heard, in minutes or hours, with or without "from now"', () => {
  assert.equal(alarmInMs('wake me up in 30 minutes'), 30 * 60e3);
  assert.equal(alarmInMs('set an alarm in an hour'), 60 * 60e3);
  assert.equal(alarmInMs('set an alarm for 20 minutes from now'), 20 * 60e3);
  assert.equal(alarmInMs('alarm in 2 hours'), 2 * 60 * 60e3);
});

test('a clock time, a timer, and an alarm with no unit are not an alarm in a time', () => {
  assert.equal(alarmInMs('set an alarm for 7'), null);
  assert.equal(alarmInMs('wake me up at 7'), null);
  assert.equal(alarmInMs('set a 20 minute timer'), null);
  assert.equal(alarmInMs('wake me up in a while'), null);
});

test('an alarm that passes midnight is set for tomorrow, and the alarm goes through the Clock’s tomorrow flag', () => {
  assert.ok(voice.includes('const crossesMidnight = at.getDate() !== new Date().getDate();'));
  assert.ok(voice.includes('clock.addAlarm(at.getHours(), at.getMinutes(), [], crossesMidnight);'));
  assert.ok(voice.includes('const inMs = alarmInMs(t);'));
});
