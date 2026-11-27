// The Claude session reader's cache is capped, so it does not grow for as long as the hub runs (src/apps/claude/server/sessions.ts).
// The reader needs the Claude folder, so this checks its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/claude/server/sessions.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the session cache is a bounded LRU cache', () => {
  assert.match(src, /const cache = new Lru<string, \{ key: string; info: Info \}>\(300\);/);
  assert.match(src, /export const sessionCacheSize = \(\): number => cache\.size;/);
});
