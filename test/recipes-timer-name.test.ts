// A cook-mode timer names its recipe, so the alert "Lasagne step 3 is done" says which dish is ready (src/apps/recipes/web/index.ts).
// The page is DOM code, so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('a cook-mode timer is named after its recipe and step', () => {
  const src = readFileSync(new URL('../src/apps/recipes/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /addTimer\(`\$\{screen\.r\.name\} step \$\{screen\.step \+ 1\}`, Number\(b\.dataset\.min\) \* 60e3\)/);
  assert.doesNotMatch(src, /addTimer\(`Step \$\{screen\.step \+ 1\}`/);
});
