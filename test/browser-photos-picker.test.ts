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

const choose = src.slice(src.indexOf('async function choosePhoto('), src.indexOf('\n}\n', src.indexOf('async function choosePhoto(')));

test('a photo fetch gives up after the picker timeout', () => {
  assert.match(choose, /fetch\(url, \{ signal: AbortSignal\.timeout\(PHOTOS_TIMEOUT_MS\) \}\)/);
});

test('a late photo is not sent to a picker that was closed or replaced', () => {
  const sendAt = choose.indexOf("browser.chooseFile(c.tab, 'photo'");
  assert.ok(sendAt > 0, 'the photo is sent');
  const before = choose.slice(0, sendAt);
  assert.ok((before.match(/if \(chooser !== c\) return;/g) ?? []).length >= 2, 'both the fetch and the file read check the picker');
});

test('a late failure on a picker that is gone flashes nothing', () => {
  const catchBlock = choose.slice(choose.indexOf('} catch {'));
  assert.ok(catchBlock.indexOf('if (chooser !== c) return;') < catchBlock.indexOf("D.flash('That photo didn’t load')"), 'the check comes before the flash');
});
