// The Recipes mock: search, random, ingredients and pantry answer with the shapes the app reads. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerMock } from '../src/core/web/mock-api.ts';
import '../src/apps/recipes/web/mock.ts';

test('search and pantry answer a list of recipes with ingredients and steps', () => {
  const search = answerMock('GET', '/api/recipes/search', null, 'q=pasta').body as { status: string; recipes: { steps: unknown[]; ingredients: unknown[] }[] };
  assert.equal(search.status, 'ok');
  assert.ok(search.recipes.length > 0 && search.recipes[0].steps.length > 0 && search.recipes[0].ingredients.length > 0);
  const pantry = answerMock('GET', '/api/recipes/pantry', null, 'have=onion&want=pasta').body as { recipes: { missing: unknown[] }[] };
  assert.ok(Array.isArray(pantry.recipes[0].missing));
});

test('random answers one recipe, and ingredients answers a list of names', () => {
  const random = answerMock('GET', '/api/recipes/random').body as { name: string };
  assert.equal(typeof random.name, 'string');
  const names = answerMock('GET', '/api/recipes/ingredients').body as { names: string[] };
  assert.ok(names.names.length > 0);
});
