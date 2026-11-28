// Tapping a step on a recipe starts cook mode at that step (src/apps/recipes/web/index.ts). The page is DOM code, so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('each step is a tap target that starts cook mode at that step, clamped to the recipe’s steps', () => {
  const src = readFileSync(new URL('../src/apps/recipes/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /const steps = r\.steps\.map\(\(s, k\) => `<li><button class="rc-step-hit" data-act="cook" data-step="\$\{k\}">\$\{esc\(s\)\}<\/button><\/li>`\)/);
  assert.match(src, /case 'cook': if \(screen\.t === 'detail'\) go\(\{ t: 'cook', r: screen\.r, step: Math\.max\(0, Math\.min\(screen\.r\.steps\.length - 1, Number\(b\.dataset\.step\) \|\| 0\)\) \}\); break;/);
});
