// The week's ingredients for Shopping (src/apps/meals/web/week.ts weekIngredients) and the button that adds them
// (src/apps/meals/web/index.ts addWeekShopping). The matching is pure, so it is tested directly; the editor is DOM code.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { weekIngredients } from '../src/apps/meals/web/week.ts';

const recipes = [
  { name: 'Tacos', ingredients: ['beef mince', 'taco shells', 'cheese'] },
  { name: 'Pasta', ingredients: ['pasta', 'cheese'] },
];

test('each dinner is matched to a saved recipe by name, ignoring case, and each ingredient is listed once', () => {
  const week = weekIngredients(['tacos', ' Pasta '], recipes);
  assert.deepEqual(week.items, ['beef mince', 'taco shells', 'cheese', 'pasta']);
  assert.deepEqual(week.unmatched, []);
});

test('a dinner with no saved recipe is reported, and an empty dinner is ignored', () => {
  const week = weekIngredients(['Pizza night', '', '  ', 'Tacos'], recipes);
  assert.deepEqual(week.unmatched, ['Pizza night']);
  assert.equal(week.items.length, 3);
});

test('the button is wired to the shared shopping logic, which uses the Shopping list and the same write as Recipes', () => {
  const src = readFileSync(new URL('../src/apps/meals/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const html = readFileSync(new URL('../src/apps/meals/view.html', import.meta.url), 'utf8');
  const shared = readFileSync(new URL('../src/apps/meals/web/week-shopping.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(html, /id="mpShop"/);
  assert.match(src, /c\.\$\('mpShop'\)\.addEventListener\('click', \(\) => void addWeekShopping\(c\)\);/);
  assert.match(src, /setStatus\(c, await addDinnersToShopping\(dinners\)\);/);
  assert.match(shared, /shoppingItems\(items, onList\)/);
  assert.match(shared, /writeList\('add', \{ list: 'shopping', text \}\)/);
});

test('a dinner with no saved recipe on two nights is named once, whatever the capitals', () => {
  const week = weekIngredients(['Pizza', 'Tacos', 'pizza'], [{ name: 'Tacos', ingredients: ['tortillas'] }]);
  assert.deepEqual(week.unmatched, ['Pizza']);
  assert.deepEqual(week.items, ['tortillas']);
});
