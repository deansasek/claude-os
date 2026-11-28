// With no list on screen, Lists hides Rename as well as Delete (src/apps/lists/web/index.ts render). The page is DOM code,
// so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the no-list view hides Rename list', () => {
  const src = readFileSync(new URL('../src/apps/lists/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /\$\('lsDelete'\)\.hidden = true;\s*\$\('lsRename'\)\.hidden = true;/);
});
