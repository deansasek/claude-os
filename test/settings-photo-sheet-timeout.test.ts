// The Settings profile photo picker gives up on a PC that does not answer, and a late read does not fill a closed or newer sheet
// (src/apps/settings/web/index.ts openPhotoSheet). The settings page talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function openPhotoSheet(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the photo list read has a timeout', () => {
  assert.match(src, /const PHOTOS_TIMEOUT_MS = 20e3;/);
  assert.match(body, /getJson<[^>]*>\('\/api\/photos\/list\?limit=120', PHOTOS_TIMEOUT_MS\)/);
});

test('each open takes the next number, and both paths check it and the open sheet before they fill the grid', () => {
  assert.match(body, /const seq = \+\+photoSheetSeq;/);
  const guards = body.match(/if \(seq !== photoSheetSeq \|\| \$\('stPhotoSheet'\)\.hidden\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check');
});

test('closing the sheet any way bumps the number', () => {
  assert.match(src, /stPhotoCancel'\)\.addEventListener\('click', \(\) => \{ photoSheetSeq\+\+;/);
  assert.match(src, /if \(e\.target === \$\('stPhotoSheet'\)\) \{ photoSheetSeq\+\+;/);
  assert.match(slice('async function usePhoto('), /photoSheetSeq\+\+;/);
});

function slice(head: string): string {
  const s = src.indexOf(head);
  assert.ok(s > 0, `${head} exists`);
  return src.slice(s, src.indexOf('\n}\n', s));
}
