// "Play the radio" while a station already plays (src/core/web/voice-radio.ts alreadyPlayingSay, wired in voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { alreadyPlayingSay } from '../src/core/web/voice-radio.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a station that plays or is tuning in is already playing; paused and stopped are not', () => {
  assert.equal(alreadyPlayingSay({ title: 'Radio 2' }, 'playing'), 'Radio 2 is already playing.');
  assert.equal(alreadyPlayingSay({ title: 'Radio 2' }, 'buffering'), 'Radio 2 is already playing.');
  assert.equal(alreadyPlayingSay(null, 'playing'), 'The radio is already playing.');
  assert.equal(alreadyPlayingSay({ title: 'Radio 2' }, 'paused'), null);
  assert.equal(alreadyPlayingSay(null, 'stopped'), null);
});

test('the play branch checks for a station already playing before it restarts the stream', () => {
  const at = voice.indexOf('const already = alreadyPlayingSay(nowPlaying(), mediaState());');
  const dispatch = voice.indexOf("dispatchEvent(new CustomEvent('hub:radio-last'));");
  assert.ok(at > 0 && at < dispatch, 'the check comes before the restart event');
});
