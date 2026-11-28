// "Turn the radio on" by voice (src/core/web/voice-radio.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { radioWord } from '../src/core/web/voice-radio.ts';

test('the radio is switched on in each wording, and starts the last station', () => {
  assert.equal(radioWord('turn the radio on'), 'play');
  assert.equal(radioWord('turn on the radio'), 'play');
  assert.equal(radioWord('switch on the radio'), 'play');
  assert.equal(radioWord('switch the radio on'), 'play');
  assert.equal(radioWord('play the radio'), 'play');
});

test('switching the radio off is still a stop, not a play', () => {
  assert.equal(radioWord('turn the radio off'), 'stop');
  assert.equal(radioWord('switch off the radio'), 'stop');
});
