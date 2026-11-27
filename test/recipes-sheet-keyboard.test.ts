// Closing the Recipes ingredient sheet closes its search keyboard (src/apps/recipes/web/index.ts closeSheet). The page is DOM
// code, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/recipes/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('function closeSheet(): void {');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('closing the ingredient sheet closes its keyboard before the sheet is hidden', () => {
  assert.ok(start > 0, 'closeSheet() exists');
  const close = body.indexOf('Keyboard.close(');
  assert.ok(close > 0, 'the keyboard is closed');
  assert.ok(close < body.indexOf("shelfQuery = ''"), 'it is closed before the search text is cleared');
});
