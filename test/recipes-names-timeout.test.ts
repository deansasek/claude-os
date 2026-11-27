// The ingredient names give up on a PC that does not answer, so the pantry sheet can retry (src/apps/recipes/web/index.ts loadNames).
// The Recipes page is DOM code, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/recipes/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the ingredient-name read has a time limit', () => {
  assert.match(src, /const NAMES_TIMEOUT_MS = 15e3;/);
  assert.match(src, /getJson<IngredientsResult>\(`\$\{API\}\/ingredients`, NAMES_TIMEOUT_MS\)/);
});
