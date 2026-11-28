// Delete does nothing while a save or delete is still in flight, and its button is greyed then (src/apps/routines/web/index.ts
// remove, render). The page is DOM code, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/routines/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('remove returns while a save or delete is in flight', () => {
  const start = src.indexOf('async function remove(id: string)');
  assert.ok(start > 0, 'remove() exists');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /^[\s\S]*?\{\n  if \(busy\) return;/, 'the busy check is the first line of remove()');
});

test('the Delete button is greyed while busy', () => {
  assert.match(src, /del\.hidden = !draft\.id;\s*del\.disabled = busy;/);
});
