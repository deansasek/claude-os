// The Photos full-size view names the day a photo was taken (src/apps/photos/web/index.ts). The page is DOM code, so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the viewer shows the real date instead of "Earlier this week"', () => {
  const src = readFileSync(new URL('../src/apps/photos/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /const viewerDayLabel = \(day: string\): string => \{/);
  assert.match(src, /if \(label !== 'Earlier this week'\) return label;/);
  assert.match(src, /\$\('phWhen'\)\.textContent = `\$\{viewerDayLabel\(day\)\}, \$\{timeOf\(p\.at\)\}`;/);
  assert.match(src, /const grid = .*dayLabel\(d\.day\)|const label = dayLabel\(d\.day\)/);
});
