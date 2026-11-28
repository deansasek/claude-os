// A second tap on Add to shopping list does not add the ingredients twice (src/apps/recipes/web/index.ts addToShopping).
// The Recipes page is DOM code, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/recipes/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('addToShopping has an in-flight flag that a second tap cannot pass', () => {
  assert.match(src, /let addingToShopping = false;/);
  assert.match(src, /async function addToShopping\(r: Recipe\): Promise<void> \{\s*if \(addingToShopping\) return;\s*addingToShopping = true;\s*try \{ await addIngredientsToShopping\(r\); \} finally \{ addingToShopping = false; \}\s*\}/);
});

test('the ingredient writes moved into the function the guard wraps', () => {
  const start = src.indexOf('async function addIngredientsToShopping(');
  assert.ok(start > 0, 'the body exists');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /writeList\('add', \{ list: 'shopping', text \}\)/);
});
