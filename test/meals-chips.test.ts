// The saved recipe names offered as dinner chips (src/apps/meals/web/week.ts savedRecipeNames), and the chips in the
// Meals editor (src/apps/meals/web/index.ts). Pure logic is tested directly; the editor is DOM code, so it is read as source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { savedRecipeNames } from '../src/apps/meals/web/week.ts';

test('the chips are the saved recipe names: unique, trimmed, and at most twelve', () => {
  const raw = JSON.stringify([{ name: ' Tacos ' }, { name: 'Pasta' }, { name: 'Tacos' }, { nope: 1 }, 'text']);
  assert.deepEqual(savedRecipeNames(raw), ['Tacos', 'Pasta']);
  const many = JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ name: `R${i}` })));
  assert.equal(savedRecipeNames(many).length, 12);
});

test('a missing or unreadable list gives no chips', () => {
  assert.deepEqual(savedRecipeNames(null), []);
  assert.deepEqual(savedRecipeNames('not json'), []);
  assert.deepEqual(savedRecipeNames('{"name":"x"}'), []);
});

test('the editor reads the Recipes list and fills the box when a chip is tapped', () => {
  const src = readFileSync(new URL('../src/apps/meals/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /const RECIPES_KEY = 'recipes\.list';/);
  assert.match(src, /savedRecipeNames\(store\.get\(RECIPES_KEY\)\)/);
  assert.match(src, /if \(b\.dataset\.act === 'pick'\) \{[\s\S]*input\.value = b\.dataset\.name/);
});
