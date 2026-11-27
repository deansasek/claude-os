// The Recipes app: reading a recipe from Claude's reply, the saved-as-text fallback, and the cook-mode step text.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { cookStep, countWord, keepPhoto, parseRecipe, pantryPrompt, textRecipe, type Recipe } from '../src/apps/recipes/web/recipe.ts';

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

test('a text recipe has one step, so its card reads "1 step"', () => {
  const r = textRecipe('Simmer the tomatoes, then blend.');
  assert.equal(r.steps.length, 1);
  assert.equal(countWord(r.steps.length, 'step'), '1 step');
});

test('countWord uses the singular for 1 and adds s otherwise', () => {
  assert.equal(countWord(0, 'step'), '0 steps');
  assert.equal(countWord(1, 'step'), '1 step');
  assert.equal(countWord(2, 'step'), '2 steps');
  assert.equal(countWord(1, 'ingredient'), '1 ingredient');
  assert.equal(countWord(0, 'ingredient'), '0 ingredients');
});

test('a cook-mode step shows its number and clamps to the steps', () => {
  const recipe: Recipe = { name: 'x', serves: '', time: '', ingredients: [], steps: ['one', 'two', 'three'] };
  assert.deepEqual(cookStep(recipe, 0), { heading: 'Step 1 of 3', text: 'one', index: 0, first: true, last: false });
  assert.equal(cookStep(recipe, 2).last, true);
  assert.equal(cookStep(recipe, 9).text, 'three');
  assert.equal(cookStep(recipe, -4).text, 'one');
});

test('the pantry prompt names the have items, the want items, and asks for the same JSON reply', () => {
  const p = pantryPrompt(['eggs', 'milk'], ['cheese']);
  assert.match(p, /mostly these ingredients I have: eggs, milk\./);
  assert.match(p, /I can also buy: cheese\. The recipe may use them\./);
  assert.match(p, /"steps"/);
  assert.match(p, /Write no other text\./);
  assert.doesNotMatch(pantryPrompt(['eggs'], []), /I can also buy/);
});

// #296: an adapted recipe keeps the source recipe's photo. It does not take the TheMealDB id.
test('an adapted recipe keeps the photo of the source recipe, and only that', () => {
  const adapted: Recipe = { name: 'Lemon pasta, gluten-free', serves: '2', time: '20 min', ingredients: [], steps: ['Cook.'] };
  const photo = 'https://www.themealdb.com/images/media/meals/abc.jpg';
  assert.deepEqual(keepPhoto(adapted, photo), { ...adapted, image: photo });
  assert.equal(keepPhoto(adapted, photo).mealId, undefined);
  assert.equal(keepPhoto(adapted, undefined), adapted);   // no photo on the source: nothing is added
  assert.equal(keepPhoto(adapted, '').image, undefined);
});

test('the reply of an adapt request gets the source photo, and the photo is kept with the pending request', () => {
  const app = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'apps', 'recipes', 'web', 'index.ts'), 'utf8');
  assert.match(app, /askClaude\(adaptPrompt\(r, text\), 'adapt', r\.image \?\? ''\)/);
  assert.match(app, /const photo = pendingKind === 'adapt' \? pendingPhoto : '';/);
  assert.match(app, /recipe: keepPhoto\(parsed\.recipe, photo\)/);
  assert.match(app, /store\.set\(PENDING_PHOTO_KEY, photo \|\| null\)/);
});

test('stepMinutes reads the time a cook step names, in whole minutes, or none', async () => {
  const { stepMinutes } = await import('../src/apps/recipes/web/recipe.ts');
  assert.equal(stepMinutes('Simmer for 25 minutes, stirring.'), 25);
  assert.equal(stepMinutes('Bake 10-15 min until golden'), 15, 'a range gives its larger number');
  assert.equal(stepMinutes('Rest for 1 hour'), 60);
  assert.equal(stepMinutes('Chop the onion finely'), null, 'no time named');
  assert.equal(stepMinutes('Leave for 500 minutes'), null, 'out of range');
});
