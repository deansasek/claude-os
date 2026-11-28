// Sketch repaints when the theme changes (src/apps/sketch/web/index.ts). The board reads its colours from the theme
// only when it draws, so a theme change while Sketch is on screen needs a redraw. Read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/sketch/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a change to the theme redraws the board', () => {
  assert.ok(src.includes("new MutationObserver(() => redraw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });"));
});

test('the redraw still takes its colours from the theme, and is guarded until the canvas exists', () => {
  assert.ok(src.includes('function redraw(): void {\n  if (!canvas || !g) return;'));
});
