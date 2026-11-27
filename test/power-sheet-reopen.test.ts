// Reopening the power menu clears the last failed-restart message (src/core/web/power-sheet.ts). The sheet is DOM code, so
// this reads the source of open(). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/core/web/power-sheet.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('open() clears the fault before it paints the menu', () => {
  const start = src.indexOf('const open = () => {');
  const body = src.slice(start, src.indexOf('paint();', start));
  assert.match(body, /stage = 'menu';\s*fault = '';/);
});

test('paint() still shows the fault in place of the usual line', () => {
  assert.match(src, /fault \|\| t\.text/);
});
