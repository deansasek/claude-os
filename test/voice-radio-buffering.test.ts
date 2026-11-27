// "Stop the radio" is heard while the radio plays or is still tuning in (src/core/web/voice-radio.ts radioStopHeard). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { radioStopHeard } from '../src/core/web/voice-radio.ts';

test('a stop is heard while the radio plays or is still buffering', () => {
  assert.equal(radioStopHeard('playing'), true);
  assert.equal(radioStopHeard('buffering'), true);
});

test('a stop is not a radio stop while it is paused or stopped', () => {
  assert.equal(radioStopHeard('paused'), false);
  assert.equal(radioStopHeard('stopped'), false);
});
