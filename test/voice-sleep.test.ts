// "Go to sleep" shows the clock screen (src/core/web/voice-sleep.ts). Near misses go to the other commands. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sleepWord } from '../src/core/web/voice-sleep.ts';

test('go to sleep, show the clock screen and rest now show the clock screen', () => {
  assert.equal(sleepWord('go to sleep'), true);
  assert.equal(sleepWord('show the clock screen'), true);
  assert.equal(sleepWord('clock screen'), true);
  assert.equal(sleepWord('rest now'), true);
});

test('near misses are not the clock screen', () => {
  assert.equal(sleepWord('good night'), false);          // a routine's phrase
  assert.equal(sleepWord('sleep focus'), false);
  assert.equal(sleepWord('open the clock'), false);
  assert.equal(sleepWord('go to sleep tonight please'), false);
});
