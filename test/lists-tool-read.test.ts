// The lists_read reply counts a notes list in words, "3 notes" or "1 note" (src/apps/lists/server/tools.ts show). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const tools = readFileSync(new URL('../src/apps/lists/server/tools.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a notes list says its count with the noun, not a bare number', () => {
  assert.ok(tools.includes("const head = l.kind === 'notes' ? `${l.name} (id ${l.id}): ${l.items.length} note${l.items.length === 1 ? '' : 's'}`"));
  assert.ok(!tools.includes('(id ${l.id}, notes): ${l.items.length}'));
});
