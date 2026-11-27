// Low power turns itself on once below the chosen level, and stays off after the user turns it off until the tablet charges.
// Source-text check: system.ts runs in the browser and needs the device bridge, so this reads the source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const system = readFileSync(new URL('../src/core/web/system.ts', import.meta.url), 'utf8');
const fn = system.slice(system.indexOf('function lowPowerCheck('), system.indexOf('/** Quiet hours and low power'));

test('low power keeps a latch that the automatic turn-on sets', () => {
  assert.match(system, /let lowAuto = false;/);
  assert.match(fn, /lowAuto = true;/);
});

test('the early return checks the latch, so a turned-off low power stays off', () => {
  assert.match(fn, /if \(!prefs\.lowAt \|\| prefs\.lowPower \|\| lowAuto\) return;/);
});

test('charging clears the latch', () => {
  assert.match(fn, /if \(b\.charging\) lowAuto = false;/);
});
