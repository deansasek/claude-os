// Stopwatch words with "a" and the read phrases (src/core/web/voice-stopwatch.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stopwatchWord } from '../src/core/web/voice-stopwatch.ts';

test('"start a stopwatch" starts it, as "start the stopwatch" does', () => {
  assert.equal(stopwatchWord('start a stopwatch'), 'start');
  assert.equal(stopwatchWord('start the stopwatch'), 'start');
  assert.equal(stopwatchWord('begin a stopwatch'), 'start');
});

test('"stop a stopwatch" and "reset a stopwatch" are accepted too', () => {
  assert.equal(stopwatchWord('stop a stopwatch'), 'stop');
  assert.equal(stopwatchWord('reset a stopwatch'), 'reset');
  assert.equal(stopwatchWord('clear the stopwatch'), 'reset');
});

test('"what\'s the stopwatch at" and the other read phrases say the time', () => {
  assert.equal(stopwatchWord("what's the stopwatch at"), 'time');
  assert.equal(stopwatchWord('what is the stopwatch on'), 'time');
  assert.equal(stopwatchWord('what does the stopwatch say'), 'time');
  assert.equal(stopwatchWord("what's the time on the stopwatch"), 'time');
  assert.equal(stopwatchWord('how long has the stopwatch been running'), 'time');
});

test('other phrases are not stopwatch words', () => {
  assert.equal(stopwatchWord("what's the stopwatch price"), null);
  assert.equal(stopwatchWord('start a timer'), null);
  assert.equal(stopwatchWord('what’s the time'), null);
});
