// The Recipes app: reading a recipe from Claude's reply, the saved-as-text fallback, and the cook-mode step text.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookStep, parseRecipe, textRecipe, type Recipe } from '../src/apps/recipes/web/recipe.ts';

const JSON_RECIPE = {
  name: 'Lemon pasta',
  serves: 2,
  time: '20 min',
  ingredients: [{ amount: '200 g', item: 'spaghetti' }, { amount: '1', item: 'lemon' }],
  steps: ['Boil the water.', { text: 'Cook the pasta for 10 minutes.' }, 'Toss with lemon.'],
};

test('a fenced JSON reply becomes a recipe', () => {
  const reply = 'Here you go:\n```json\n' + JSON.stringify(JSON_RECIPE, null, 2) + '\n```\nEnjoy!';
  const r = parseRecipe(reply);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.recipe.name, 'Lemon pasta');
  assert.equal(r.recipe.serves, '2');
  assert.equal(r.recipe.time, '20 min');
  assert.deepEqual(r.recipe.ingredients[0], { amount: '200 g', item: 'spaghetti' });
  assert.deepEqual(r.recipe.steps, ['Boil the water.', 'Cook the pasta for 10 minutes.', 'Toss with lemon.']);
});

test('JSON without a code fence is still read', () => {
  const r = parseRecipe('Sure. ' + JSON.stringify(JSON_RECIPE));
  assert.equal(r.ok, true);
});

test('a reply with no recipe JSON, or with no name or steps, is not a recipe', () => {
  assert.equal(parseRecipe('Pasta is great with lemon.').ok, false);
  assert.equal(parseRecipe('```json\n{"name": "", "steps": ["x"]}\n```').ok, false);
  assert.equal(parseRecipe('{"name": "No steps", "steps": []}').ok, false);
  assert.equal(parseRecipe('{ broken json').ok, false);
});

test('a reply that is not a recipe is saved as text, one step', () => {
  const r = textRecipe('# Tomato soup\nSimmer the tomatoes, then blend.');
  assert.equal(r.name, 'Tomato soup');
  assert.deepEqual(r.steps, ['# Tomato soup\nSimmer the tomatoes, then blend.']);
  assert.deepEqual(r.ingredients, []);
  assert.equal(textRecipe('   ').name, 'Saved reply');
});

test('a cook-mode step shows its number and clamps to the steps', () => {
  const recipe: Recipe = { name: 'x', serves: '', time: '', ingredients: [], steps: ['one', 'two', 'three'] };
  assert.deepEqual(cookStep(recipe, 0), { heading: 'Step 1 of 3', text: 'one', index: 0, first: true, last: false });
  assert.equal(cookStep(recipe, 2).last, true);
  assert.equal(cookStep(recipe, 9).text, 'three');
  assert.equal(cookStep(recipe, -4).text, 'one');
});
