// The ingredients a recipe puts on the Shopping list: trimmed, capitalised, no repeats, and none already on the list. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shoppingItems } from '../src/apps/recipes/web/recipe.ts';

test('the names are trimmed, capitalised and not repeated', () => {
  assert.deepEqual(shoppingItems(['  flour ', 'Eggs', 'eggs', 'Sugar  cane'], []), ['Flour', 'Eggs', 'Sugar cane']);
});

test('an ingredient already on the list (any case) is left out', () => {
  assert.deepEqual(shoppingItems(['Milk', 'Butter', 'bread'], ['MILK', 'bread']), ['Butter']);
});

test('the empty names are left out and the count is capped', () => {
  assert.deepEqual(shoppingItems(['', '   ', 'Salt'], []), ['Salt']);
  assert.equal(shoppingItems(Array.from({ length: 50 }, (_, i) => `item ${i}`), [], 40).length, 40);
});
