// Quick sums by voice (src/core/web/voice-math.ts, worked out by the Calculator's parser). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mathSay } from '../src/core/web/voice-math.ts';

test('a plain sum is worked out and said with the Calculator’s result', () => {
  assert.equal(mathSay("what's 12 times 7"), '12 times 7 is 84.');
  assert.equal(mathSay('what is 100 divided by 8'), '100 divided by 8 is 12.5.');
  assert.equal(mathSay("what's 15 plus 27"), '15 plus 27 is 42.');
  assert.equal(mathSay("what's 20 percent of 60"), '20 percent of 60 is 12.');
  assert.equal(mathSay("what's half of 30"), 'half of 30 is 15.');
  assert.equal(mathSay("how much is 9 minus 4"), '9 minus 4 is 5.');
});

test('a division by zero, a number on its own, and a phrase with words in it are not sums', () => {
  assert.equal(mathSay("what's 5 divided by 0"), null);
  assert.equal(mathSay("what's 12"), null);
  assert.equal(mathSay("what's my alarm"), null);
  assert.equal(mathSay("what's the weather"), null);
  assert.equal(mathSay('what is 3 plus cheese'), null);
});
