// The Weather units setting is saved to the PC even when no forecast is loaded (src/apps/weather/web/index.ts, setUnits).
// The web page is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/weather/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function setUnits(u: Units)');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('setUnits sends the unit to the PC without a loaded forecast as a condition', () => {
  assert.ok(start > 0, 'setUnits exists');
  assert.match(body, /try \{ await sendLocation\(\{ units: u \}\); \}\s*catch \{ notify\(/);
  assert.doesNotMatch(body, /isOk\(wx\)/);
});

test('setUnits restores the saved unit and repaints when the save fails', () => {
  assert.match(body, /const prev = pickUnits;/);
  assert.match(body, /catch \{ notify\([^]*?report\('wx-units-failed'\); pickUnits = prev; paintUnits\(\); \}/);
});
