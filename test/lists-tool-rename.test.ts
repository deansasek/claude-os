// Claude can rename a family list with the lists_rename tool (src/apps/lists/server/tools.ts). The MCP server needs the
// SDK, so the tool and its approval-card label are read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const tools = readFileSync(new URL('../src/apps/lists/server/tools.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cards = readFileSync(new URL('../src/apps/claude/web/tools.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('lists_rename renames the list through renameList, and the items stay on it', () => {
  assert.ok(tools.includes("tool('lists_rename',"));
  assert.ok(tools.includes('const out = renameList(l.id, name);'));
  assert.ok(tools.includes('renameList, tickItem'));
});

test('the approval card names the lists_rename tool', () => {
  assert.ok(cards.includes("'mcp__claudeos_lists__lists_rename': { now: 'Rename a list', past: 'Renamed a list', doing: 'Renaming a list' },"));
});
