// The Recipes app: a TheMealDB meal as the app's recipe shape, the steps split from the instructions text, the
// prompts for Adapt with Claude and Suggest for tonight, and the recipe of the day. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapMeal, mapMeals, splitSteps } from '../src/apps/recipes/web/mealdb.ts';
import { adaptPrompt, fromStored, parseRecipe, recipeGlance, recipeOfDay, tonightPrompt, type Recipe } from '../src/apps/recipes/web/recipe.ts';

const MEAL = {
  idMeal: '52772',
  strMeal: 'Teriyaki Chicken Casserole',
  strCategory: 'Chicken',
  strArea: 'Japanese',
  strInstructions: 'STEP 1\r\nPreheat oven to 350° F.\r\n\r\nSTEP 2\r\nCombine soy sauce and sugar in a pan.\r\n3. Pour over the chicken.\r\n',
  strMealThumb: 'https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg',
  strIngredient1: 'soy sauce', strMeasure1: '3/4 cup',
  strIngredient2: 'water', strMeasure2: '1/2 cup ',
  strIngredient3: 'brown sugar', strMeasure3: '',
  strIngredient4: '', strMeasure4: ' ',
  strIngredient5: null, strMeasure5: null,
};

test('a TheMealDB meal becomes a recipe with amounts, steps, photo, id and tag', () => {
  const r = mapMeal(MEAL);
  assert.ok(r);
  assert.equal(r.name, 'Teriyaki Chicken Casserole');
  assert.equal(r.serves, '');
  assert.equal(r.time, '');
  assert.deepEqual(r.ingredients, [
    { amount: '3/4 cup', item: 'soy sauce' },
    { amount: '1/2 cup', item: 'water' },
    { amount: '', item: 'brown sugar' },
  ]);
  assert.deepEqual(r.steps, ['Preheat oven to 350° F.', 'Combine soy sauce and sugar in a pan.', 'Pour over the chicken.']);
  assert.equal(r.image, MEAL.strMealThumb);
  assert.equal(r.mealId, '52772');
  assert.equal(r.tag, 'Japanese · Chicken');
});

test('a meal with no name, no steps, or a non-https photo is handled', () => {
  assert.equal(mapMeal({ ...MEAL, strMeal: '' }), null);
  assert.equal(mapMeal({ ...MEAL, strInstructions: '' }), null);
  assert.equal(mapMeal(null), null);
  assert.equal(mapMeal({ ...MEAL, strMealThumb: 'http://example.com/a.jpg' })?.image, undefined);
  assert.equal(mapMeal({ ...MEAL, strArea: 'Unknown' })?.tag, 'Chicken');
});

test('one paragraph of instructions is split into sentences', () => {
  assert.deepEqual(splitSteps('Boil the pasta. Drain it well! Add the sauce.'), ['Boil the pasta.', 'Drain it well!', 'Add the sauce.']);
  assert.deepEqual(splitSteps('1. Chop the onion.\n2) Fry it.\n1.5 cups of stock go in last.'), ['Chop the onion.', 'Fry it.', '1.5 cups of stock go in last.']);
  assert.deepEqual(splitSteps(undefined), []);
});

test('a list of meals drops bad ones and repeats', () => {
  const list = mapMeals([MEAL, { ...MEAL }, { strMeal: 'No steps' }, { ...MEAL, idMeal: '1', strMeal: 'Other' }]);
  assert.deepEqual(list.map(r => r.name), ['Teriyaki Chicken Casserole', 'Other']);
  assert.deepEqual(mapMeals({ meals: null }), []);
});

test('a stored recipe keeps its photo, id and tag; a Claude recipe has none', () => {
  const r = mapMeal(MEAL)!;
  assert.deepEqual(fromStored(JSON.parse(JSON.stringify(r))), r);
  const claude = fromStored({ name: 'Soup', serves: '2', time: '30 min', ingredients: [], steps: ['Cook.'] });
  assert.deepEqual(claude, { name: 'Soup', serves: '2', time: '30 min', ingredients: [], steps: ['Cook.'] });
});

test('the Adapt and Tonight prompts ask for the same JSON reply', () => {
  const r = mapMeal(MEAL)!;
  const adapt = adaptPrompt(r, 'for four people,  gluten-free');
  assert.match(adapt, /^Change this recipe: for four people, gluten-free\./);
  assert.match(adapt, /"steps"/);
  assert.doesNotMatch(adapt, /themealdb\.com|52772/);
  assert.match(adapt, /Write no other text\.$/);
  const tonight = tonightPrompt(['Lemon pasta', 'Soup'], '40 minutes');
  assert.match(tonight, /40 minutes or less/);
  assert.match(tonight, /Lemon pasta; Soup/);
  assert.doesNotMatch(tonightPrompt([], ''), /saved recipes|or less/);
  // a reply in the asked format is read by the same parser
  assert.equal(parseRecipe('```json\n{"name":"Pasta","steps":["Boil."]}\n```').ok, true);
});

test('the recipe of the day is stable within a day and moves at midnight', () => {
  const list: Recipe[] = ['A', 'B', 'C'].map(name => ({ name, serves: '', time: '', ingredients: [], steps: ['x'] }));
  const morning = new Date(2026, 10, 23, 7, 0), night = new Date(2026, 10, 23, 23, 59), next = new Date(2026, 10, 24, 0, 1);
  assert.equal(recipeOfDay(3, morning), recipeOfDay(3, night));
  assert.equal(recipeOfDay(3, next), (recipeOfDay(3, morning) + 1) % 3);
  assert.equal(recipeOfDay(0, morning), -1);
  assert.equal(recipeGlance([], morning), 'Find a recipe');
  assert.equal(recipeGlance(list, morning), list[recipeOfDay(3, morning)].name);
});
