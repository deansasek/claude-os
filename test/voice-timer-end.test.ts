// "What time will the timer go off" by voice (src/core/web/voice-alarm.ts; the reply is in voice-commands.ts, read as source).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { timerEndWord } from '../src/core/web/voice-alarm.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the timer end questions are matched', () => {
  assert.equal(timerEndWord('what time will the timer go off'), true);
  assert.equal(timerEndWord('when does the timer finish'), true);
  assert.equal(timerEndWord('when will the timer be done'), true);
  assert.equal(timerEndWord('when is the timer up'), true);
});

test('how long is left and other timer questions are not the end time', () => {
  assert.equal(timerEndWord('how long is left on the timer'), false);
  assert.equal(timerEndWord('pause the timer'), false);
  assert.equal(timerEndWord('when does the shop open'), false);
});

test('the reply gives the clock time, and says a paused timer is paused with its time left', () => {
  assert.ok(voice.includes('if (timerEndWord(t)) {'));
  assert.ok(voice.includes('const at = new Date(Date.now() + left).toLocaleTimeString'));
  assert.ok(voice.includes('`The timer is paused, with ${sayDuration(Math.ceil(left / 1000) * 1000)} left.`'));
  assert.ok(voice.includes("'There’s no timer running.'"));
});
