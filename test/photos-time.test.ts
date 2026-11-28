// A photo's time follows the 24-hour setting in Settings (src/apps/photos/web/index.ts). The page reads the setting
// through clock() in format.ts, which needs the DOM, so the wiring is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/photos/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the photo time is shown through clock(), which follows the 24-hour setting', () => {
  assert.ok(src.includes("import { clock } from '../../../core/web/format.ts';"));
  assert.ok(src.includes('const timeOf = (at: string): string => clock(new Date(at));'));
  assert.equal(src.includes("toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })"), false);
});

test('the grid cell label and the viewer line both use the same time', () => {
  assert.ok(src.includes('aria-label="Photo at ${esc(timeOf(p.at))}"'));
  assert.ok(src.includes('`${viewerDayLabel(day)}, ${timeOf(p.at)}`'));
});
