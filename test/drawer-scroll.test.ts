// Source-text check for the pull-down drawer: its DOM code runs in the browser, so this reads public/core.css and
// src/core/web/system.ts. The panel scrolls when its tiles and notifications are taller than the stage, and the
// drag-to-close gesture still leaves a scrolled panel alone.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../public/core.css', import.meta.url), 'utf8');
const system = readFileSync(new URL('../src/core/web/system.ts', import.meta.url), 'utf8');

test('the pull-down panel scrolls vertically inside the stage height', () => {
  const rule = css.match(/^  \.cc-panel \{[^}]*\}/m)?.[0];
  assert.ok(rule, 'core.css has a base .cc-panel rule');
  assert.match(rule, /max-height: 100%/);
  assert.match(rule, /overflow-y: auto/);
  assert.match(rule, /overscroll-behavior: contain/);
});

test('a drag on a scrolled panel scrolls it and does not close the pull-down', () => {
  assert.match(system, /const scrolled = \(el: HTMLElement\) => \{/);
  assert.ok(system.includes("|| scrolled(t)) return;"), 'the pointerdown close path stops at a scrolled panel');
});
