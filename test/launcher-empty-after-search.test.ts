// The launcher empty message comes back after a search is cleared (src/apps/launcher/web/index.ts, paintResults).
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

test('paintResults repaints the empty message when no search text is set', () => {
  assert.match(fn('paintResults'), /else paintEmpty\(\);/);
});

test('setEditing still calls paintEmpty', () => {
  assert.match(fn('setEditing'), /paintEmpty\(\);/);
});
