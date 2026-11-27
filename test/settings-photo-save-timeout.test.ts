// The profile photo save and remove give up on a PC that does not answer, and an answer to an older pick or remove does not undo a
// newer photo (src/apps/settings/web/index.ts usePhoto, removePhoto). The settings page talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const use = slice('async function usePhoto(');
const remove = slice('async function removePhoto(');

test('the photo save and remove both have a 20 second timeout', () => {
  assert.match(src, /const PHOTO_SAVE_TIMEOUT_MS = 20e3;/);
  assert.match(use, /signal: AbortSignal\.timeout\(PHOTO_SAVE_TIMEOUT_MS\)/);
  assert.match(remove, /postJson<[\s\S]*?>\('\/api\/settings\/photo\/remove', \{\}, PHOTO_SAVE_TIMEOUT_MS\)/);
});

test('each save or remove takes the next number, and both paths drop an answer that is no longer the newest', () => {
  assert.match(use, /const seq = \+\+photoSaveSeq;/);
  assert.match(remove, /const seq = \+\+photoSaveSeq;/);
  assert.ok(use.indexOf('if (seq !== photoSaveSeq) return;') > use.indexOf('await r.json') || use.indexOf('if (seq !== photoSaveSeq) return;') > use.indexOf('} catch { j = null; }'), 'the save checks after the answer');
  const removeGuards = remove.match(/if \(seq !== photoSaveSeq\) return;/g) ?? [];
  assert.equal(removeGuards.length, 2, 'the remove checks on both paths');
});
