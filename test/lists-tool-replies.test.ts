// The lists_add and lists_clear_done replies say what happened to the data, not only that something was done (src/apps/lists/server/tools.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const tools = readFileSync(new URL('../src/apps/lists/server/tools.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('lists_clear_done says how many it cleared, or that nothing was ticked', () => {
  assert.ok(tools.includes("const removed = (r as { removed?: number }).removed ?? 0;"));
  assert.ok(tools.includes("if (!removed) return text(`Nothing on ${l?.name ?? list} was ticked, so nothing was cleared.${left}`);"));
});

test('lists_add says an item already on the list is already there, not added', () => {
  assert.ok(tools.includes("if (same) return text(same.done ? `“${same.text}” was ticked, so it is back on ${l?.name ?? list}.` : `“${same.text}” is already on ${l?.name ?? list}.`);"));
});
