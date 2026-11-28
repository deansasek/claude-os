// One pointer draws a stroke at a time (src/apps/sketch/web/index.ts). The page is DOM code, so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/sketch/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a second pointer does not start a stroke while one is drawing', () => {
  assert.match(src, /if \(pointer !== null\) return;/);
  assert.match(src, /pointer = e\.pointerId;/);
});

test('only the drawing pointer extends its stroke, and only its own up or cancel ends it', () => {
  assert.match(src, /canvas\.addEventListener\('pointermove', e => \{\s*if \(pointer !== e\.pointerId\) return;/);
  assert.match(src, /const stop = \(e: PointerEvent\): void => \{ if \(pointer === e\.pointerId\) pointer = null; \};/);
  assert.doesNotMatch(src, /let drawing|!drawing|drawing = /);
});
