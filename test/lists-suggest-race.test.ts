// A late Shopping suggestion read does not paint its chips after the family has left Shopping, or after a newer
// load started (src/apps/lists/web/index.ts loadSuggest). The page is DOM code with no unit seam, so this reads its
// source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/lists/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function loadSuggest(): Promise<void> {');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('loadSuggest takes the next number and drops an answer that is no longer the newest', () => {
  assert.ok(start > 0, 'loadSuggest() exists');
  assert.match(src, /let suggestSeq = 0;/);
  assert.match(body, /const seq = \+\+suggestSeq;/);
  assert.match(body, /if \(seq !== suggestSeq \|\| current !== 'shopping'\) return;/);
});

test('the read still has the sync timeout', () => {
  assert.match(body, /\/suggest\?list=shopping`, SYNC_TIMEOUT_MS\)/);
});
