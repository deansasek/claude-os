// Voice words for the stopwatch (src/core/web/voice-stopwatch.ts): start it, or stop it. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stopwatchWord } from '../src/core/web/voice-stopwatch.ts';

test('start and stop the stopwatch are heard', () => {
  assert.equal(stopwatchWord('start the stopwatch'), 'start');
  assert.equal(stopwatchWord('resume my stopwatch'), 'start');
  assert.equal(stopwatchWord('stop the stopwatch'), 'stop');
  assert.equal(stopwatchWord('pause the stopwatch'), 'stop');
});

test('other phrases are not stopwatch words', () => {
  assert.equal(stopwatchWord('open stopwatch'), null);
  assert.equal(stopwatchWord('start the timer'), null);
  assert.equal(stopwatchWord('stop the radio'), null);
});
