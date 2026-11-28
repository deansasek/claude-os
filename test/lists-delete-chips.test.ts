// After a family list is deleted, Lists moves off it and the Shopping chips come back (src/apps/lists/web/index.ts). The page is
// DOM code, so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('deleting a list moves off it and reloads the suggestions once the PC answers', () => {
  const src = readFileSync(new URL('../src/apps/lists/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /void send\('delete-list', \{ list: id \}\)\.then\(\(\) => \{[^\n]*\n\s*if \(current === id\) current = 'shopping';\s*render\(\);\s*void loadSuggest\(\);\s*\}\);/);
});
