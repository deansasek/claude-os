// "How long is left on the pasta timer" (src/core/web/voice-alarm.ts and voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { namedTimerLeftLabel } from '../src/core/web/voice-alarm.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const clock = readFileSync(new URL('../src/apps/clock/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the timer label is taken from "how long is left on the pasta timer" and its variants', () => {
  assert.equal(namedTimerLeftLabel('how long is left on the pasta timer'), 'pasta');
  assert.equal(namedTimerLeftLabel('how much longer on the pasta timer'), 'pasta');
  assert.equal(namedTimerLeftLabel('time left on my tea timer'), 'tea');
  assert.equal(namedTimerLeftLabel('how long is left on the eggs timer'), 'eggs');
});

test('a bare timer, a timer with a time in it, and other phrases are not a named timer', () => {
  assert.equal(namedTimerLeftLabel('how long is left on the timer'), null);
  assert.equal(namedTimerLeftLabel('how long is left on the 10 minute timer'), null);
  assert.equal(namedTimerLeftLabel('how long is left'), null);
  assert.equal(namedTimerLeftLabel('cancel the pasta timer'), null);
});

test('the reply reads the named timer’s own time, and the clock answers for that label', () => {
  assert.ok(voice.includes('clock.namedTimerLeft(namedLeft)'));
  assert.ok(voice.includes('You don’t have ${articleFor(namedLeft)} ${heardLeft} timer.'));
  assert.ok(voice.includes('left on the ${heardLeft} timer'));
  assert.ok(clock.includes('namedTimerLeft(label: string): { ms: number; paused: boolean } | null'));
});
