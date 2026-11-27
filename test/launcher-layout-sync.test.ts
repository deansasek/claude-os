// The Apps layout sync gives up on a PC that does not answer, and a late older read does not undo a tile move
// (src/apps/launcher/web/index.ts push, pull, saveLayout). The module talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/launcher/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const push = slice('async function push(');
const pull = slice('async function pull(');
const save = slice('function saveLayout(');

test('the layout timeout is defined, and the push and the pull both pass it', () => {
  assert.match(src, /const LAYOUT_TIMEOUT_MS = 15e3;/);
  assert.match(push, /signal: AbortSignal\.timeout\(LAYOUT_TIMEOUT_MS\),/);
  assert.match(pull, /getJson<LauncherLayoutResult>\(`\$\{API\}\?screen=\$\{SCREEN\}`, LAYOUT_TIMEOUT_MS\)/);
});

test('every layout edit counts, and a pull drops its answer if an edit came while it was out', () => {
  assert.match(save, /edits\+\+;/);
  assert.match(pull, /const at = edits;/);
  assert.ok(pull.indexOf('if (at !== edits) return;') > pull.indexOf('const at = edits;'), 'the check comes after the read');
  assert.ok(pull.indexOf('if (at !== edits) return;') < pull.indexOf('layout = next;'), 'the check comes before the layout is replaced');
});
