// The lists tools tell Claude the real name limit, and say notes for a notes list (src/apps/lists/server/tools.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const tools = readFileSync(new URL('../src/apps/lists/server/tools.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const api = readFileSync(new URL('../src/apps/lists/api.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the name limit in the tool descriptions is the store’s limit, not a made-up number', () => {
  assert.match(api, /export const MAX_LIST_NAME = 24;/);
  assert.ok(tools.includes('up to ${MAX_LIST_NAME} characters. It starts empty.`,'));
  assert.ok(tools.includes('up to ${MAX_LIST_NAME} characters. The items stay on it.`,'));
  assert.doesNotMatch(tools, /up to 40 characters/);
});

test('a notes list is counted in notes when an item is added, not in to-do', () => {
  assert.ok(tools.includes("const count = l?.kind === 'notes' ? ` (${l.items.length} note${l.items.length === 1 ? '' : 's'})` : l ? ` (${open} to do)` : '';"));
});
