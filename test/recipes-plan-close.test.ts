// Leaving a recipe page closes its Plan this panel (src/apps/recipes/web/index.ts go). The page is DOM code, so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('every screen change closes the Plan this panel', () => {
  const src = readFileSync(new URL('../src/apps/recipes/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /function go\(next: Screen\): void \{\s*screen = next;\s*saveCook\(\);\s*planning = false;/);
});
