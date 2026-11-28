// Claude's recipes_get tool gives one recipe's ingredients and numbered method (src/apps/recipes/server/tools.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { recipesGetReply } from '../src/apps/recipes/server/tools.ts';

const recipe = (name: string, steps: string[], extra: object = {}) => ({
  name, tag: 'Italian · Pasta', serves: '', time: '', steps, ...extra,
  ingredients: [{ amount: '400g', item: 'Pasta' }, { amount: '', item: 'Salt' }],
}) as never;
const found = (list: unknown[]) => async () => ({ status: 'ok', recipes: list }) as never;

test('a recipe comes with every ingredient, its amount, and a numbered method', async () => {
  const r = await recipesGetReply({ name: 'Lasagne' }, found([recipe('Lasagne', ['Boil the pasta.', 'Bake it.'], { serves: '4', time: '40 min' })]));
  assert.equal(r.content[0].text, 'Lasagne (serves 4, 40 min)\nIngredients: 400g Pasta; Salt.\nMethod:\n1. Boil the pasta.\n2. Bake it.');
});

test('an exact name wins over the first match; with no exact name, the first match is given', async () => {
  const r = await recipesGetReply({ name: 'soup' }, found([recipe('Chicken soup', ['Cook.']), recipe('Soup', ['Stir.'])]));
  assert.match(r.content[0].text, /^Soup\n/);
  const first = await recipesGetReply({ name: 'stew' }, found([recipe('Beef stew', ['Simmer.'])]));
  assert.match(first.content[0].text, /^Beef stew\n/);
});

test('a recipe with no method says so, and no match or a failed search says why', async () => {
  const bare = await recipesGetReply({ name: 'Toast' }, found([recipe('Toast', [])]));
  assert.match(bare.content[0].text, /No method is listed\./);
  const none = await recipesGetReply({ name: 'zzz' }, found([]));
  assert.equal(none.isError, true);
  assert.match(none.content[0].text, /No recipe matches “zzz”/);
  const failed = await recipesGetReply({ name: 'soup' }, async () => ({ status: 'error', recipes: [], error: 'down' }) as never);
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /couldn’t be read/);
});

test('the tool is wired in and its approval card has plain words', () => {
  const tools = readFileSync(new URL('../src/apps/recipes/server/tools.ts', import.meta.url), 'utf8');
  const cards = readFileSync(new URL('../src/apps/claude/web/tools.ts', import.meta.url), 'utf8');
  assert.ok(tools.includes("tool('recipes_get',"));
  assert.ok(cards.includes("'mcp__claudeos_recipes__recipes_get': { now: 'Get a recipe', past: 'Got a recipe', doing: 'Getting a recipe' },"));
});
