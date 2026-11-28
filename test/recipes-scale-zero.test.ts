// A scaled amount never reads as 0 (src/apps/recipes/web/scale.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kitchenNumber, scaleAmount } from '../src/apps/recipes/web/scale.ts';

test('a tiny positive amount reads as the smallest kitchen fraction, not 0', () => {
  assert.equal(kitchenNumber(0.031), '1/8');
  assert.equal(kitchenNumber(0.01), '1/8');
  assert.equal(kitchenNumber(0), '0');
});

test('scaling a quarter teaspoon down to one serving of an eight-serving recipe reads 1/8, not 0', () => {
  assert.equal(scaleAmount('1/4 tsp', 1 / 8), '1/8 tsp');
});

test('ordinary amounts are unchanged by the fix', () => {
  assert.equal(kitchenNumber(2), '2');
  assert.equal(kitchenNumber(1.5), '1 1/2');
  assert.equal(scaleAmount('2 cups', 2), '4 cups');
});
