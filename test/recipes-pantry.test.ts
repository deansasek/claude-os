// Recipes: the "What do you have" rules (web/pantry.ts): the names, the staples, the cap of 8, and the ranking.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { missingFor, parsePantry, rankPantry, type PantryRecipe } from '../src/apps/recipes/web/pantry.ts';
import type { Recipe } from '../src/apps/recipes/web/recipe.ts';

const recipe = (name: string, items: string[]): Recipe => ({
  name, serves: '', time: '', steps: ['Cook.'], ingredients: items.map(item => ({ amount: '', item })),
});

test('staples never count as missing; a "have" or "want" name does not either', () => {
  const r = recipe('Rice bowl', ['Salt', 'Chicken', 'Water', 'Rice', 'Olive oil']);
  assert.deepEqual(missingFor(r, ['chicken'], []), ['Rice']);
  assert.deepEqual(missingFor(r, ['chicken'], ['rice']), []);
});

test('the names are trimmed, lower-cased and de-duplicated; a name in both lists is "have"', () => {
  const p = parsePantry(' Eggs, eggs ,Milk', 'milk,Cheese');
  assert.deepEqual(p, { ok: true, have: ['eggs', 'milk'], want: ['cheese'] });
});

test('more than 8 names is an error; 8 is allowed', () => {
  assert.equal(parsePantry('a,b,c,d', 'e,f,g,h').ok, true);
  assert.deepEqual(parsePantry('a,b,c,d', 'e,f,g,h,i'), { ok: false, error: 'Pick at most 8 ingredients.' });
});

test('recipes sort by missing names, then by names used, then by name', () => {
  const list = [
    { recipe: recipe('Zucchini bake', ['Egg', 'Flour']), matched: 1 },   // missing 1
    { recipe: recipe('Beta soup', ['Egg']), matched: 1 },                // missing 0
    { recipe: recipe('Alpha stew', ['Egg', 'Milk']), matched: 2 },       // missing 0, more names used
    { recipe: recipe('Aardvark pie', ['Egg']), matched: 1 },             // missing 0, same as Beta, earlier name
  ];
  const names = rankPantry(list, ['egg', 'milk'], []).map((r: PantryRecipe) => r.name);
  assert.deepEqual(names, ['Alpha stew', 'Aardvark pie', 'Beta soup', 'Zucchini bake']);
});
