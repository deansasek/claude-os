// A Home Assistant tile toggle or scene gives up on a PC that does not answer, so the tile is not busy for good
// (src/apps/home-assistant/web/index.ts setScene and tap). The module talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/home-assistant/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const setScene = slice('async function setScene(');
const tap = slice('async function tap(');

test('the post timeout is set', () => {
  assert.match(src, /const POST_TIMEOUT_MS = 15_000;/);
});

test('the scene and toggle posts both use the timeout', () => {
  assert.match(setScene, /postJson<HaResult>\(`\$\{API\}\/scene`, \{ entity_id: id \}, POST_TIMEOUT_MS\)/);
  assert.match(tap, /postJson<HaResult>\(`\$\{API\}\/toggle`, \{ entity_id: id, on: !e\.on \}, POST_TIMEOUT_MS\)/);
});
