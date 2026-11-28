// Claude's recipes_pantry tool finds recipes from the ingredients the user has, each with what it is missing (src/apps/recipes/server/tools.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { recipesPantryReply } from '../src/apps/recipes/server/tools.ts';

const recipe = (name: string, missing: string[]) => ({ id: name, name, serves: '', time: '', tag: '', steps: [], ingredients: [], matched: 2, missing }) as never;
const found = (list: unknown[]) => async () => ({ status: 'ok', recipes: list }) as never;

test('each recipe says what it is missing, the fewest first, or that the user has everything', async () => {
  const r = await recipesPantryReply({ have: 'chicken, rice' }, found([recipe('Chicken soup', ['carrot']), recipe('Chicken rice', [])]));
  assert.equal(r.content[0].text, 'Chicken soup: missing carrot\nChicken rice: you have everything');
});

test('no recipes, a failed search, and a pantry that is refused each say so plainly', async () => {
  const none = await recipesPantryReply({ have: 'zzz' }, found([]));
  assert.equal(none.isError, true);
  const failed = await recipesPantryReply({ have: 'rice' }, async () => ({ status: 'error', recipes: [], error: 'Pick at most 8 ingredients.' }) as never);
  assert.equal(failed.isError, true);
  assert.equal(failed.content[0].text, 'Pick at most 8 ingredients.');
});

test('the tool is wired in and its approval card has plain words', () => {
  const tools = readFileSync(new URL('../src/apps/recipes/server/tools.ts', import.meta.url), 'utf8');
  const cards = readFileSync(new URL('../src/apps/claude/web/tools.ts', import.meta.url), 'utf8');
  assert.ok(tools.includes("tool('recipes_pantry',"));
  assert.ok(cards.includes("'mcp__claudeos_recipes__recipes_pantry': { now: 'Look for recipes with what you have', past: 'Looked for recipes with what you have', doing: 'Looking for recipes with what you have' },"));
});
