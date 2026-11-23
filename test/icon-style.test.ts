// App icons follow the Weather icon's style (src/core/web/app-icons.ts, scripts/check-icons.ts). Run with: npm test
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { checkIcons, iconProblems } = await import('../scripts/check-icons.ts');
const { APP_ICONS, appIcon, clockIcon } = await import('../src/core/web/app-icons.ts');

test('every app icon and the Weather reference pass the icon check', () => {
  assert.deepEqual(checkIcons(ROOT), []);
});

test('an app icon is the same markup every time, on the 32 grid with the 1.8 pen', () => {
  for (const name of APP_ICONS) {
    const svg = appIcon(name);
    assert.equal(svg, appIcon(name));
    assert.match(svg, /^<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/);
  }
  assert.notEqual(clockIcon(new Date(2026, 0, 1, 3, 0)), clockIcon(new Date(2026, 0, 1, 9, 0)));
});

test('the check catches icons that break the style', () => {
  const pen = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
  // the old Settings icon: a 2.0 pen
  assert.match(iconProblems(`<svg viewBox="0 0 32 32" ${pen} stroke-width="2"><path d="M6 10h11"/></svg>`).join(), /2\.00 pen/);
  assert.match(iconProblems(`<svg viewBox="0 0 24 24" ${pen} stroke-width="1.8"><path d="M6 10h11"/></svg>`).join(), /viewBox/);
  assert.match(iconProblems('<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 10h11"/></svg>').join(), /round line caps/);
  assert.match(iconProblems(`<svg viewBox="0 0 32 32" ${pen} stroke-width="1.8"><path d="M6 10h11" stroke="#d93025"/></svg>`).join(), /hex colour/);
  assert.match(iconProblems('<svg viewBox="0 0 32 32"><rect x="4" y="4" width="20" height="20" fill="currentColor"/></svg>').join(), /filled shape/);
  assert.match(iconProblems('<svg viewBox="0 0 32 32"><image href="a.png"/></svg>').join(), /<image>/);
  assert.match(iconProblems(`<svg viewBox="0 0 32 32" ${pen} stroke-width="1.8"><path d="M1 1L31 31"/></svg>`, { bounds: true }).join(), /outside/);
});
