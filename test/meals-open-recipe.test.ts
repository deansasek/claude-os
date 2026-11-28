// A Meals night named after a saved recipe opens that recipe in Recipes (src/apps/meals/web/week.ts recipeFor, and index.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { recipeFor } from '../src/apps/meals/web/week.ts';

test('a dinner matches a saved recipe by name, ignoring case and spaces at the ends', () => {
  assert.equal(recipeFor(' lasagne ', ['Tacos', 'Lasagne']), 'Lasagne');
  assert.equal(recipeFor('Pizza night', ['Tacos', 'Lasagne']), null);
  assert.equal(recipeFor('   ', ['Tacos']), null);
  assert.equal(recipeFor('Tacos', []), null);
});

test('a night named after a recipe gets an Open the recipe link, which opens Recipes with that name', () => {
  const src = readFileSync(new URL('../src/apps/meals/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /const recipe = dinner \? recipeFor\(dinner\.text, savedRecipeNames\(store\.get\(RECIPES_KEY\)\)\) : null;/);
  assert.match(src, /data-act="recipe" data-name="\$\{esc\(recipe\)\}"/);
  assert.match(src, /if \(b\.dataset\.act === 'recipe'\) \{ openApp\('recipes'\); dispatchEvent\(new CustomEvent\('hub:open-recipe', \{ detail: b\.dataset\.name \?\? '' \}\)\); \}/);
  assert.match(src, /import \{ openApp \} from '\.\.\/\.\.\/\.\.\/core\/web\/system\.ts';/);
});
