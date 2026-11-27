// The Weather day list's rain line rounds the amount before it decides between Dry and a chance (src/apps/weather/web/rain-line.ts).
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rainLine } from '../src/apps/weather/web/rain-line.ts';

test('a tiny amount that rounds to nothing reads Dry, in inches', () => {
  assert.equal(rainLine(5, 0.004, 'in'), 'Dry');
});

test('a chance with a tiny amount shows the chance only', () => {
  assert.equal(rainLine(40, 0.004, 'in'), '40% chance of rain');
});

test('a real amount in inches is shown', () => {
  assert.equal(rainLine(40, 0.25, 'in'), '40% chance of rain, 0.25 in');
});

test('a tiny amount that rounds to nothing reads Dry, in millimetres', () => {
  assert.equal(rainLine(5, 0.04, 'mm'), 'Dry');
});

test('a real amount in millimetres is shown', () => {
  assert.equal(rainLine(5, 4.2, 'mm'), '5% chance of rain, 4.2 mm');
});
