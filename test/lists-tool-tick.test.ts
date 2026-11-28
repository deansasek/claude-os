// lists_tick says when an item is already ticked, or not ticked, and names the lists for a wrong list name (src/apps/lists/server/tools.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const tools = readFileSync(new URL('../src/apps/lists/server/tools.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('lists_tick says an item already ticked, or not ticked, changed nothing, and names the lists when the list is wrong', () => {
  assert.ok(tools.includes("if (!l) return text(`There’s no list called “${list}”. The lists are: ${before.lists.map(x => x.name).join(', ')}.`, true);"));
  assert.ok(tools.includes("if (same && (done !== false) === same.done) return text(done !== false ? `“${same.text}” was already ticked off.` : `“${same.text}” was not ticked, so nothing changed.`);"));
});
