// The Home Assistant climate modes in plain words: every mapped mode, and an unknown one never shows its raw name.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { climateLabel } from '../src/apps/home-assistant/api.ts';

test('climate modes map to plain words', () => {
  assert.equal(climateLabel('heat'), 'Heating');
  assert.equal(climateLabel('cool'), 'Cooling');
  assert.equal(climateLabel('auto'), 'Auto');
  assert.equal(climateLabel('heat_cool'), 'Auto');
  assert.equal(climateLabel('dry'), 'Drying');
  assert.equal(climateLabel('fan_only'), 'Fan only');
});

test('an unknown mode gets its name spaced and capitalised', () => {
  assert.equal(climateLabel('off_now'), 'Off now');
});

test('an empty mode gives an empty label', () => {
  assert.equal(climateLabel(''), '');
});
