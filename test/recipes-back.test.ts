// Hardware Back in Recipes goes up one level instead of leaving the app (src/apps/recipes/web/index.ts). The page is DOM code,
// so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('Back closes a sheet or the Plan panel first, then goes from cook mode to the recipe and from a recipe to Discover', () => {
  const src = readFileSync(new URL('../src/apps/recipes/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /import \{ alertFor, onBack \} from '\.\.\/\.\.\/\.\.\/core\/web\/system\.ts';/);
  assert.match(src, /onBack\(\(\) => \{\s*if \(!ctx\?\.isVisible\(\)\) return false;\s*if \(sheetOpen\) \{ closeSheet\(\); return true; \}\s*if \(planning\) \{ planning = false; render\(\); return true; \}/);
  assert.match(src, /if \(screen\.t === 'cook'\) \{ go\(\{ t: 'detail', r: screen\.r \}\); render\(\); return true; \}/);
  assert.match(src, /if \(screen\.t === 'detail'\) \{ go\(\{ t: 'discover' \}\); render\(\); return true; \}\s*return false;\s*\}, 10\);/);
});
