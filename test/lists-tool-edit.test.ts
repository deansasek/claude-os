// Claude can change a list item's words with the lists_edit tool (src/apps/lists/server/tools.ts). The MCP server needs the
// SDK, so the tool and its approval-card label are read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const tools = readFileSync(new URL('../src/apps/lists/server/tools.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cards = readFileSync(new URL('../src/apps/claude/web/tools.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('lists_edit changes the item’s words through editItem, keeping its place and tick', () => {
  assert.ok(tools.includes("tool('lists_edit',"));
  assert.ok(tools.includes('const out = editItem(l.id, hit.id, to);'));
  assert.ok(tools.includes("editItem, findItem, newList"));
});

test('the approval card names the lists_edit tool', () => {
  assert.ok(cards.includes("'mcp__claudeos_lists__lists_edit': { now: 'Change a list item', past: 'Changed a list item', doing: 'Changing a list item' },"));
});
