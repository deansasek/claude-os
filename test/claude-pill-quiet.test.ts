// The Claude app's usage pill: hidden while the usage data is live, shown for every warning state.
// Source-text check on src/apps/claude/web/index.ts and app.css (the pill is set in tick() and load()). Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (rel: string) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const index = read('src/apps/claude/web/index.ts');
const css = read('src/apps/claude/app.css');

test('the pill is hidden only when the limits status is ok with no error', () => {
  assert.match(index, /pill\.hidden = L\.status === 'ok' && !L\.error;/);
});

test('the live state still sets the Live or Demo data text before the hide rule runs', () => {
  assert.match(index, /pill\.className = 'live ok'; pillText\.textContent = DEMO \? 'Demo data' : 'Live';/);
});

test('each warning state keeps its text, so the pill shows for it', () => {
  for (const text of ["`As of ${asOf}`", "'Last known'", "'Limits not connected'", "'Sign-in expired'",
    "'Waiting on Anthropic'", "'Can’t reach Anthropic'"]) {
    assert.ok(index.includes(text), `missing pill text ${text}`);
  }
});

test('a failed load shows the Offline pill again', () => {
  assert.match(index, /\$\('pill'\)\.hidden = false;/);
  assert.match(index, /'Offline'; \$\('pill'\)\.hidden = false;/);
});

test('the hidden attribute wins over the .live display rule', () => {
  assert.match(css, /#app-claude #pill\[hidden\] \{ display: none; \}/);
});
