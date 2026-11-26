// A failed Claude sessions read must let the next search open read again, and the empty search message must say so (src/apps/launcher/web/index.ts, loadSearchData and paintResults).
// The launcher is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/launcher/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const fn = (name: string) => {
  const start = src.indexOf(`function ${name}(`);
  return src.slice(start, src.indexOf('\n}\n', start));
};

test('loadSearchData resets loadedAt and sets searchReadFailed when the sessions read fails', () => {
  const body = fn('loadSearchData');
  assert.match(body, /loadedAt = 0;/);
  assert.match(body, /searchReadFailed = true;/);
});

test('paintResults uses searchReadFailed in the empty message', () => {
  assert.match(fn('paintResults'), /searchReadFailed/);
});
