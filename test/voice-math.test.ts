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

test('a sum said with a thousands comma is worked out, and a comma between short numbers is not', () => {
  assert.equal(mathSay("what's 1,500 divided by 3"), '1500 divided by 3 is 500.');
  assert.equal(mathSay("what's 2,000 plus 1,250"), '2000 plus 1250 is 3250.');
  assert.equal(mathSay("what's 1, 2"), null);
});

test('a number squared or cubed is worked out, and squared with no number is not a sum', () => {
  assert.equal(mathSay("what's 7 squared"), '7 squared is 49.');
  assert.equal(mathSay("what's 1.5 squared"), '1.5 squared is 2.25.');
  assert.equal(mathSay("what's 3 cubed"), '3 cubed is 27.');
  assert.equal(mathSay("what's 12 squared plus 1"), '12 squared plus 1 is 145.');
  assert.equal(mathSay("what's squared"), null);
});

test('a sum that starts with minus or negative is worked out, and a takeaway is still a takeaway', () => {
  assert.equal(mathSay("what's minus 5 plus 3"), 'minus 5 plus 3 is -2.');
  assert.equal(mathSay("what's negative 4 times 3"), 'negative 4 times 3 is -12.');
  assert.equal(mathSay("what's 3 times minus 2"), '3 times minus 2 is -6.');
  assert.equal(mathSay("what's 9 minus 4"), '9 minus 4 is 5.');
});

test('a division by zero, a number on its own, and a phrase with words in it are not sums', () => {
  assert.equal(mathSay("what's 5 divided by 0"), null);
  assert.equal(mathSay("what's 12"), null);
  assert.equal(mathSay("what's my alarm"), null);
  assert.equal(mathSay("what's the weather"), null);
  assert.equal(mathSay('what is 3 plus cheese'), null);
});

test('sums said with symbols from speech are worked out, and a volume or brightness percent is not a sum', () => {
  assert.equal(mathSay("What's 5 + 3?"), '5 + 3 is 8.');
  assert.equal(mathSay("what's 12 × 7"), '12 × 7 is 84.');
  assert.equal(mathSay('what is 12 x 7'), '12 x 7 is 84.');
  assert.equal(mathSay("what's 100 ÷ 8"), '100 ÷ 8 is 12.5.');
  assert.equal(mathSay("what's 15% of 80"), '15% of 80 is 12.');
  assert.equal(mathSay("what's 9 - 4"), '9 - 4 is 5.');
  assert.equal(mathSay('volume 30%'), null);
  assert.equal(mathSay('brightness 50%'), null);
});
