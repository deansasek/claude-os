// Lists' Rename opens the keyboard with the list's current name, and an unchanged name writes nothing (src/apps/lists/web/index.ts).
// The page is DOM code, so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('Rename fills in the current name, and an unchanged name is not sent', () => {
  const src = readFileSync(new URL('../src/apps/lists/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('function renameNow(): void {');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /value: l\.name, placeholder: `Rename \$\{l\.name\}`/);
  assert.match(body, /if \(!name \|\| name === l\.name\) return;/);
});
