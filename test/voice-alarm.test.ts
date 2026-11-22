// Voice words for alarms: "stop" silences a ringing alarm, and only "all my alarms" switches every alarm off.
// Pure matching (src/core/web/voice-alarm.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alarmWord } from '../src/core/web/voice-alarm.ts';

test('stop silences the ring while an alarm or timer sounds', () => {
  assert.equal(alarmWord('stop', true), 'stop-ring');
  assert.equal(alarmWord('stop the alarm', true), 'stop-ring');
  assert.equal(alarmWord('stop the timer', true), 'stop-ring');
  assert.equal(alarmWord('turn off', true), 'stop-ring');
});

test('"stop the alarm" never switches every alarm off while one rings', () => {
  assert.notEqual(alarmWord('stop the alarm', true), 'all-off');
  assert.notEqual(alarmWord('stop the alarm', false), 'all-off');
});

test('snooze applies while a ring sounds', () => {
  assert.equal(alarmWord('snooze', true), 'snooze');
  assert.equal(alarmWord('snooze it', true), 'snooze');
  assert.equal(alarmWord('snooze', false), null);
});

test('only the all-alarms phrases switch every alarm off', () => {
  assert.equal(alarmWord('turn off all my alarms', false), 'all-off');
  assert.equal(alarmWord('cancel all alarms', false), 'all-off');
  assert.equal(alarmWord('clear my alarms', false), 'all-off');
  assert.equal(alarmWord('stop all my alarms', false), 'all-off');
});

test('a singular alarm with nothing ringing is not an all-off', () => {
  assert.equal(alarmWord('turn off my alarm', false), 'one-alarm');
  assert.equal(alarmWord('stop the alarm', false), 'one-alarm');
});

test('unrelated text is not an alarm word', () => {
  assert.equal(alarmWord('what time is it', true), null);
  assert.equal(alarmWord('set an alarm for 7', false), null);
});
