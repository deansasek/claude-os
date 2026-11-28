// The alarm list phrases, with "how many" and the British "have I got" (src/core/web/voice-alarm.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alarmsListWord } from '../src/core/web/voice-alarm.ts';

test('the alarm list is heard with "how many" and "have I got" as well as the usual wordings', () => {
  assert.equal(alarmsListWord('how many alarms do i have'), true);
  assert.equal(alarmsListWord('how many alarms are on'), true);
  assert.equal(alarmsListWord('what alarms have i got'), true);
  assert.equal(alarmsListWord('which alarms do i have'), true);
  assert.equal(alarmsListWord('what alarms do i have'), true);
  assert.equal(alarmsListWord('list my alarms'), true);
});

test('a time-left question is not the alarm list', () => {
  assert.equal(alarmsListWord('how long until my alarm'), false);
  assert.equal(alarmsListWord('how many minutes until my alarm'), false);
});
