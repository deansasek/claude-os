// Voice words for alarms: "stop" silences a ringing alarm, and only "all my alarms" switches every alarm off.
// Pure matching (src/core/web/voice-alarm.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alarmTimePhrase, alarmWord, timerWord } from '../src/core/web/voice-alarm.ts';

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

test('one alarm by its time is named, and "all my alarms" is not', () => {
  assert.equal(alarmTimePhrase('turn off my 7 am alarm'), '7 am');
  assert.equal(alarmTimePhrase('cancel the 6 30 alarm'), '6 30');
  assert.equal(alarmTimePhrase('turn off all my alarms'), null);
  assert.equal(alarmTimePhrase('turn off my alarm'), null);
  assert.equal(alarmTimePhrase('stop the alarm'), null);
});

test('timer words: pause, resume, and minutes added or taken off', () => {
  assert.deepEqual(timerWord('pause the timer'), { op: 'pause' });
  assert.deepEqual(timerWord('resume my timer'), { op: 'resume' });
  assert.deepEqual(timerWord('add five minutes to the timer'), { op: 'nudge', minutes: 5 });
  assert.deepEqual(timerWord('add 2 minutes to my timer'), { op: 'nudge', minutes: 2 });
  assert.deepEqual(timerWord('take two minutes off the timer'), { op: 'nudge', minutes: -2 });
  assert.deepEqual(timerWord('add a minute to the timer'), { op: 'nudge', minutes: 1 });
  assert.deepEqual(timerWord('cancel all my timers'), { op: 'cancel-all' });
  assert.deepEqual(timerWord('stop the timers'), { op: 'cancel-all' });
  assert.deepEqual(timerWord('clear all timers'), { op: 'cancel-all' });
  assert.equal(timerWord('cancel the timer'), null);   // the singular still takes the one-timer path
  assert.deepEqual(timerWord('take a minute off my timer'), { op: 'nudge', minutes: -1 });
  assert.equal(timerWord('add banana minutes to the timer'), null);
  assert.equal(timerWord('add 500 minutes to the timer'), null);
  assert.equal(timerWord('pause'), null);
});

test('"more" or "extra" before the minutes is still a timer nudge', () => {
  assert.deepEqual(timerWord('add five more minutes to the timer'), { op: 'nudge', minutes: 5 });
  assert.deepEqual(timerWord('give me two extra minutes on the timer'), { op: 'nudge', minutes: 2 });
  assert.deepEqual(timerWord('take 2 more minutes off the timer'), { op: 'nudge', minutes: -2 });
  assert.deepEqual(timerWord('add 5 minutes to the timer'), { op: 'nudge', minutes: 5 });
});

test('an hour and half an hour are a 60 and a 30 minute timer nudge, both ways', () => {
  assert.deepEqual(timerWord('add an hour to the timer'), { op: 'nudge', minutes: 60 });
  assert.deepEqual(timerWord('add half an hour to the timer'), { op: 'nudge', minutes: 30 });
  assert.deepEqual(timerWord('take an hour off the timer'), { op: 'nudge', minutes: -60 });
  assert.deepEqual(timerWord('take half an hour off my timer'), { op: 'nudge', minutes: -30 });
});
