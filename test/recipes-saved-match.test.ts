// A recipe still matches its saved copy after a reload in cook mode (sameRecipe in src/apps/recipes/web/recipe.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookFromStored, fromStored, sameRecipe } from '../src/apps/recipes/web/recipe.ts';

const soup = { name: 'Soup', ingredients: [], steps: ['Chop', 'Simmer', 'Serve'] };
const stew = { name: 'Stew', ingredients: [], steps: ['Brown', 'Stir'] };

test('a recipe without a mealId matches its saved copy after a reload', () => {
  const saved = fromStored(soup)!;
  const back = cookFromStored(JSON.parse(JSON.stringify({ r: soup, step: 1 })))!.r;
  assert.notEqual(back, saved);
  assert.equal(sameRecipe(saved, back), true);
});

test('two different recipes without a mealId do not match', () => {
  assert.equal(sameRecipe(fromStored(soup)!, fromStored(stew)!), false);
});

test('two copies with the same mealId match', () => {
  const a = fromStored({ ...soup, mealId: '52771' })!;
  const b = fromStored({ ...stew, mealId: '52771' })!;
  assert.equal(sameRecipe(a, b), true);
});
