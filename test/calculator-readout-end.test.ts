// A long typed sum keeps its newest digits in view (src/apps/calculator/web/index.ts paint). The readout is in the DOM,
// so the wiring is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/calculator/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the readout scrolls to its end when it is painted, so the digits being typed show', () => {
  assert.ok(src.includes('shown.scrollLeft = shown.scrollWidth;'));
  assert.ok(src.includes('shown.textContent = display(state);'));
});
