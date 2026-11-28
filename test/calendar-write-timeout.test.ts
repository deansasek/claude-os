// A Calendar add, edit or delete gives up on a PC that does not answer, so Save and Delete work again (src/apps/calendar/web/index.ts).
// The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/calendar/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const add = slice('async function addEvent(');
const del = slice('async function deleteDetail(');

test('the write timeout is defined', () => {
  assert.match(src, /const WRITE_TIMEOUT_MS = 10_000;/);
});

test('the add, edit and delete posts all pass the write timeout', () => {
  assert.match(add, /local-update`, \{ id, \.\.\.body \}, WRITE_TIMEOUT_MS\)/);
  assert.match(add, /local-add`, body, WRITE_TIMEOUT_MS\)/);
  assert.match(del, /local-delete`, \{ id: e\.id \}, WRITE_TIMEOUT_MS\)/);
});
