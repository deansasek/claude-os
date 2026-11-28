// Claude's lists_suggest tool gives the items the family often buys that are not on the list now (src/apps/lists/server/tools.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { listsSuggestReply } from '../src/apps/lists/server/tools.ts';

const lists = { ok: true, lists: [{ id: 'shopping', name: 'Shopping', kind: 'checklist', items: [{ id: '1', text: 'Milk', done: false }] }] } as never;

test('the suggestions are the often-bought items that are not on the list', () => {
  const r = listsSuggestReply('Shopping', () => lists, (onList) => (onList.includes('Milk') ? ['Eggs', 'Bread'] : []));
  assert.equal(r.content[0].text, 'Often bought, and not on Shopping now: Eggs, Bread.');
});

test('no suggestions, and a list that is not there, are said plainly', () => {
  assert.equal(listsSuggestReply('Shopping', () => lists, () => []).content[0].text, 'Nothing to suggest for Shopping yet.');
  const missing = listsSuggestReply('Garden', () => lists, () => []);
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /no list called “Garden”/);
});

test('the tool is wired in and its approval card has plain words', () => {
  const tools = readFileSync(new URL('../src/apps/lists/server/tools.ts', import.meta.url), 'utf8');
  const cards = readFileSync(new URL('../src/apps/claude/web/tools.ts', import.meta.url), 'utf8');
  assert.ok(tools.includes("tool('lists_suggest',"));
  assert.ok(cards.includes("'mcp__claudeos_lists__lists_suggest': { now: 'Look at what you often buy', past: 'Looked at what you often buy', doing: 'Looking at what you often buy' },"));
});
