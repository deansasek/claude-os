// Home's Shopping row opens the Shopping tab in Lists, not the tab used last (src/apps/home/web/index.ts). The page is DOM code,
// so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the Shopping row names the Shopping list when it opens Lists', () => {
  const src = readFileSync(new URL('../src/apps/home/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /if \(go === 'lists'\) \{ openApp\('lists'\); dispatchEvent\(new CustomEvent\('hub:open-list', \{ detail: 'shopping' \}\)\); return; \}/);
});
