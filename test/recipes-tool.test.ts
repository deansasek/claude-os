// Claude's recipes_search tool searches the Recipes app's TheMealDB search (src/apps/recipes/server/tools.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { recipesSearchReply } from '../src/apps/recipes/server/tools.ts';

const recipe = (name: string, tag: string, items: string[]) => ({
  name, serves: '', time: '', steps: [], tag,
  ingredients: items.map(item => ({ amount: '', item })),
}) as never;
const found = (recipes: unknown[]) => async () => ({ status: 'ok', recipes }) as never;

test('each recipe comes as its name, its tag and its main ingredients, up to the count asked', async () => {
  const r = await recipesSearchReply({ q: 'lasagne', count: 2 }, found([
    recipe('Lasagne', 'Italian · Pasta', ['Beef', 'Pasta', 'Cheese']),
    recipe('Vegetable lasagne', 'Italian · Vegetarian', ['Courgette']),
    recipe('Third', 'Other', ['Rice']),
  ]));
  assert.equal(r.content[0].text, 'Lasagne (Italian · Pasta): Beef, Pasta, Cheese\nVegetable lasagne (Italian · Vegetarian): Courgette');
});

test('no match says so; a failed search says it could not be read', async () => {
  const none = await recipesSearchReply({ q: 'zzz' }, found([]));
  assert.equal(none.isError, true);
  assert.match(none.content[0].text, /No recipes match “zzz”/);
  const failed = await recipesSearchReply({ q: 'soup' }, async () => ({ status: 'error', recipes: [], error: 'down' }) as never);
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /couldn’t be read/);
});

test('the tool is wired into each session, and its approval card has plain words', () => {
  const turns = readFileSync(new URL('../src/apps/claude/server/turns.ts', import.meta.url), 'utf8');
  const cards = readFileSync(new URL('../src/apps/claude/web/tools.ts', import.meta.url), 'utf8');
  assert.ok(turns.includes('claudeos_recipes: recipesServer'));
  assert.ok(cards.includes("'mcp__claudeos_recipes__recipes_search': { now: 'Search recipes', past: 'Searched recipes', doing: 'Searching recipes' },"));
});
