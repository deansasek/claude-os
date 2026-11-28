// "1 degree", not "1 degrees" (src/core/web/voice-weather.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { degSay, frostSay, lowTonightSay } from '../src/core/web/voice-weather.ts';

test('one degree is singular, and every other count is plural', () => {
  assert.equal(degSay(1), '1 degree');
  assert.equal(degSay(-1), '-1 degree');
  assert.equal(degSay(0.6), '1 degree');
  assert.equal(degSay(-0.4), '0 degrees');
  assert.equal(degSay(2), '2 degrees');
});

test('the overnight low and the frost answer say one degree correctly', () => {
  assert.equal(lowTonightSay(1), 'Down to 1 degree tonight.');
  assert.equal(frostSay(-1, 'celsius'), 'Yes, down to -1 degree tonight: below freezing.');
  assert.equal(frostSay(1, 'celsius'), 'No, the low tonight is 1 degree.');
  assert.equal(frostSay(-2, 'celsius'), 'Yes, down to -2 degrees tonight: below freezing.');
});
