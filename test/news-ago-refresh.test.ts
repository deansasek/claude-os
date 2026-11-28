// News redraws its "ago" labels when it comes back on screen (src/apps/news/web/index.ts). The page is DOM code, so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the time labels keep their publish time, and News redraws them when it is shown', () => {
  const src = readFileSync(new URL('../src/apps/news/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /w\.dataset\.published = item\.published \?\? ''; m\.append\(w\);/);
  assert.match(src, /w\.dataset\.published = item\.published \?\? '';\s*b\.append\(top, el\('span', 'nw-tile-title', item\.title\), w\);/);
  assert.match(src, /function refreshAgo\(\): void \{[\s\S]*querySelectorAll<HTMLElement>\('\[data-published\]'\)/);
  assert.match(src, /else refreshAgo\(\);/);
});
