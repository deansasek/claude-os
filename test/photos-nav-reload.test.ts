// The Photos viewer's position and arrows follow a list reload while the viewer is open (src/apps/photos/web/index.ts load).
// The page is DOM code, so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('a list reload repaints the viewer position and arrows while the viewer is open', () => {
  const src = readFileSync(new URL('../src/apps/photos/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('async function load(): Promise<void> {');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /paint\(\);\s*if \(shown\) paintNav\(\);/);
});
