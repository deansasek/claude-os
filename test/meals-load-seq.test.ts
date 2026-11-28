// A late older Meals week read does not fill the nights on screen after the week has changed (src/apps/meals/web/index.ts load).
// The page is DOM code, so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('each week read takes the next number, and a stale answer is dropped on both paths', () => {
  const src = readFileSync(new URL('../src/apps/meals/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('async function load(c: AppContext): Promise<void> {');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(src, /let loadSeq = 0;/);
  assert.match(body, /const seq = \+\+loadSeq;/);
  const guards = body.match(/if \(seq !== loadSeq\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
});
