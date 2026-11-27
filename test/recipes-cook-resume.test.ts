// Cook mode comes back on the same recipe and step after a reload (cookFromStored in src/apps/recipes/web/recipe.ts).
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookFromStored } from '../src/apps/recipes/web/recipe.ts';

const soup = { name: 'Soup', ingredients: [], steps: ['Chop', 'Simmer', 'Serve'] };

test('a saved cook position comes back on its recipe and step', () => {
  const c = cookFromStored({ r: soup, step: 1 });
  assert.equal(c?.r.name, 'Soup');
  assert.equal(c?.step, 1);
});

test('a step past the last step is clamped to it', () => {
  assert.equal(cookFromStored({ r: soup, step: 9 })?.step, 2);
});

test('a broken saved position is dropped, so the page shows Discover', () => {
  assert.equal(cookFromStored(null), null);
  assert.equal(cookFromStored('x'), null);
  assert.equal(cookFromStored({ r: soup, step: -1 }), null);
  assert.equal(cookFromStored({ r: soup, step: 1.5 }), null);
  assert.equal(cookFromStored({ r: { name: '' }, step: 0 }), null);
});
