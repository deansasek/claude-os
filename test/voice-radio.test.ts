// Voice words for the radio (src/core/web/voice-radio.ts): play the last station, or pause it. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { radioWord } from '../src/core/web/voice-radio.ts';

test('play and stop the radio are heard', () => {
  assert.equal(radioWord('play the radio'), 'play');
  assert.equal(radioWord('turn on the radio'), 'play');
  assert.equal(radioWord('resume my radio'), 'play');
  assert.equal(radioWord('stop the radio'), 'stop');
  assert.equal(radioWord('pause the radio'), 'stop');
  assert.equal(radioWord('turn the radio off'), 'stop');
});

test('other phrases are not radio words', () => {
  assert.equal(radioWord('open radio'), null);
  assert.equal(radioWord('stop the timer'), null);
  assert.equal(radioWord('play music'), null);
  assert.equal(radioWord('is the radio on'), null);
});
