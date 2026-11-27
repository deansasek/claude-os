// The drawer's brightness slider is greyed while Android's auto-brightness is on (src/core/web/system.ts, public/core.css).
// Source-text check: the DOM code runs in the browser, so this reads the two files. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../public/core.css', import.meta.url), 'utf8');
const system = readFileSync(new URL('../src/core/web/system.ts', import.meta.url), 'utf8');

test('the drawer brightness slider is disabled while auto-brightness is on', () => {
  assert.match(system, /\$s\('ccBright'\) as HTMLInputElement\)\.disabled = autoBrightness\.on;/);
});

test('the brightness drag does not write the saved brightness while auto-brightness is on', () => {
  assert.match(system, /bind\('ccBright', v => \{ if \(!autoBrightness\.on\) prefs\.brightness = Math\.max\(\.02, v\); \}\);/);
});

test('the disabled brightness slider is greyed', () => {
  assert.match(css, /\.cc-slide input\[type=range\]:disabled \{ opacity: \.4; \}/);
});
