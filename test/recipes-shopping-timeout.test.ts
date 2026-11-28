// The Shopping list read in Add to Shopping gives up on a PC that does not answer, so the page can say nothing was added
// (src/apps/recipes/web/index.ts addToShopping). The Recipes page is DOM code, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/recipes/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the Shopping list read has a time limit', () => {
  assert.match(src, /const LISTS_TIMEOUT_MS = 20e3;/);
  assert.match(src, /readLists\(LISTS_TIMEOUT_MS\)\)\.find\(l => l\.id === 'shopping'\)/);
  assert.doesNotMatch(src, /readLists\(\)/, 'no bare readLists() call is left');
});
