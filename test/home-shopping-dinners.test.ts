// Home's Shopping row counts this week's dinner ingredients that are not on the list (src/apps/meals/web/week.ts
// missingIngredients, src/apps/home/web/lists-row.ts, and the wiring in src/apps/home/web/index.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { missingIngredients } from '../src/apps/meals/web/week.ts';
import { listsRow } from '../src/apps/home/web/lists-row.ts';

const recipes = [
  { name: 'Tacos', ingredients: ['beef mince', 'taco shells', 'cheese'] },
  { name: 'Pasta', ingredients: ['pasta', 'Cheese'] },
];

test('the count is the dinner ingredients not yet on the list, each counted once, names compared without case', () => {
  assert.equal(missingIngredients(['Tacos', 'Pasta'], recipes, []), 4);   // beef mince, taco shells, cheese, pasta
  assert.equal(missingIngredients(['Tacos', 'Pasta'], recipes, ['CHEESE', ' pasta ']), 2);
  assert.equal(missingIngredients(['Tacos'], recipes, ['beef mince', 'taco shells', 'cheese']), 0);
  assert.equal(missingIngredients(['Pizza night'], recipes, []), 0);   // no saved recipe, nothing to count
});

test('the Shopping row says how many dinner ingredients are missing, and keeps the Offline mark first', () => {
  const lists = { items: [{ done: false, text: 'Milk' }] };
  assert.deepEqual(listsRow(lists, false, 3), { val: '1 to get', sub: 'Milk · 3 from this week’s dinners' });
  assert.deepEqual(listsRow(lists, false, null), { val: '1 to get', sub: 'Milk' });
  assert.deepEqual(listsRow(lists, false, 0), { val: '1 to get', sub: 'Milk' });
  assert.deepEqual(listsRow(lists, true, 2), { val: '1 to get', sub: 'Offline · Milk · 2 from this week’s dinners' });
});

test('Home counts the week’s dinners against the saved recipes and the Shopping list, and repaints when the dinners load', () => {
  const src = readFileSync(new URL('../src/apps/home/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /weekDinnerTexts = dinners\.map\(d => d\.text\);/);
  assert.match(src, /missingIngredients\(weekDinnerTexts, savedIngredients\(\), lists\.items\.filter/);
  assert.match(src, /paintLists\(\);   \/\/ the Shopping row counts this week's dinner ingredients/);
  assert.match(src, /store\.get\('recipes\.list'\)/);
});
