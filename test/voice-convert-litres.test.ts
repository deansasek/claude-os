// Litres by voice (src/core/web/voice-convert.ts): a litre is 1000 millilitres. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertSay } from '../src/core/web/voice-convert.ts';

test('a litre in millilitres is a thousand, both ways round', () => {
  assert.equal(convertSay('how many millilitres in a litre'), '1000 millilitres in a litre.');
  assert.equal(convertSay('what’s 2 litres in millilitres'), '2 litres is 2000 millilitres.');
  assert.equal(convertSay('how many litres in 500 millilitres'), '0.5 litres in 500 millilitres.');
});

test('a litre converts to a kitchen unit through millilitres', () => {
  assert.equal(convertSay('convert 1 litre to millilitres'), '1 litre is 1000 millilitres.');
  assert.equal(convertSay('what’s 2l in ml'), '2 litres is 2000 millilitres.');
});

test('a litre to a litre, or a litre to a weight, is not a conversion', () => {
  assert.equal(convertSay('how many litres in a litre'), null);
  assert.equal(convertSay('what’s 2 litres in grams'), null);
});

test('a litre joined to its number is heard as the unit', () => {
  assert.equal(convertSay('what’s 3l in millilitres'), '3 litres is 3000 millilitres.');
});
