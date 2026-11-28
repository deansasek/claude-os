// "Do I have an alarm tomorrow" (src/core/web/voice-alarm.ts, voice-commands.ts). The matcher is tested directly; the handler is
// read as source, since it needs the Clock. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { alarmTomorrowWord, alarmsListWord } from '../src/core/web/voice-alarm.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the tomorrow alarm phrases are heard, and other alarm questions are not', () => {
  assert.equal(alarmTomorrowWord('is my alarm set for tomorrow'), true);
  assert.equal(alarmTomorrowWord('do i have an alarm tomorrow'), true);
  assert.equal(alarmTomorrowWord('what time is my alarm tomorrow'), true);
  assert.equal(alarmTomorrowWord('is there an alarm tomorrow'), true);
  assert.equal(alarmTomorrowWord('what alarms do i have'), false);
  assert.equal(alarmsListWord('what alarms do i have'), true);
});

test('the handler checks the weekday of tomorrow and the one-off alarms set for tomorrow', () => {
  assert.match(voice, /if \(alarmTomorrowWord\(t\)\) \{/);
  assert.match(voice, /tomorrow\.setDate\(tomorrow\.getDate\(\) \+ 1\);/);
  assert.match(voice, /const rings = clock\.alarmsOn\(\)\.filter\(a => \(a\.days\.length \? a\.days\.includes\(dow\) : a\.when === 'tomorrow'\)\)/);
  assert.match(voice, /return \{ say: `Yes, your alarm is at \$\{clockText\(rings\[0\]\.h, rings\[0\]\.m\)\} tomorrow\.`/);
});

test('the reply gives the earliest alarm tomorrow by time of day, not by the next ring', () => {
  assert.match(voice, /\.sort\(\(a, b\) => a\.h \* 60 \+ a\.m - \(b\.h \* 60 \+ b\.m\)\);/);
});
