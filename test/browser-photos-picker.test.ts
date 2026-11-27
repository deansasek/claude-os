// The upload photo picker gives up on a PC that does not answer, and a late read does not fill a newer or closed picker
// (src/apps/browser/web/panels.ts openPhotos, closeOver). The module talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/browser/web/panels.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const open = slice('async function openPhotos(');
const close = slice('function closeOver(');

test('the timeout is defined and the list read passes it', () => {
  assert.match(src, /const PHOTOS_TIMEOUT_MS = 8000;/);
  assert.match(open, /getJson<PhotoList>\('\/api\/photos\/list\?limit=80', PHOTOS_TIMEOUT_MS\)/);
});

test('each opening takes the next number, and both paths drop a read that is no longer current', () => {
  assert.match(open, /const seq = \+\+photosSeq;/);
  const guards = open.match(/if \(seq !== photosSeq \|\| !chooser\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number and the picker');
});

test('closing the picker drops any list read still out', () => {
  assert.match(close, /if \(id === 'brPhotos'\) photosSeq\+\+;/);
});
