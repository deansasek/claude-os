// A refused list edit puts the old text back on screen (src/apps/lists/web/index.ts edit()). Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

// The Lists screen is DOM code with no unit seam, so this reads the source of edit().
test('a refused edit puts the old text back, as tick() does', () => {
  const src = fs.readFileSync(new URL('../src/apps/lists/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('function edit(id: string): void {');
  assert.ok(start > 0, 'edit() exists');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  const keep = body.indexOf('const was = it.text;');
  const set = body.indexOf('it.text = t;');
  assert.ok(keep > 0 && keep < set, 'the old text is kept before the new text is set');
  assert.match(body, /\.then\(r => \{ if \(!r \|\| !r\.ok\) it\.text = was; \}\)/, 'a refused send restores the old text');
});
