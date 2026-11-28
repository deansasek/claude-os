// "What's playing" says the station and whether it is paused (src/core/web/voice-radio.ts, wired in voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { playingSay, radioWord } from '../src/core/web/voice-radio.ts';

test('what is playing, what station is this and what is on the radio are heard', () => {
  assert.equal(radioWord("what's playing"), 'whats-playing');
  assert.equal(radioWord('what is playing'), 'whats-playing');
  assert.equal(radioWord('what station is this'), 'whats-playing');
  assert.equal(radioWord("what's on the radio"), 'whats-playing');
  assert.equal(radioWord('play the radio'), 'play');
});

test('the reply names the station, or says nothing is playing, or that it is paused', () => {
  assert.equal(playingSay({ title: 'Radio 2', subtitle: 'Jo Whiley' }, 'playing'), 'Radio 2, Jo Whiley.');
  assert.equal(playingSay({ title: 'Radio 4' }, 'playing'), 'Radio 4.');
  assert.equal(playingSay({ title: 'Radio 2', subtitle: 'Jo Whiley' }, 'paused'), 'Radio 2, Jo Whiley. Paused.');
  assert.equal(playingSay(null, 'stopped'), 'Nothing is playing.');
  assert.equal(playingSay({ title: 'Radio 2' }, 'stopped'), 'Nothing is playing.');
});

test('the radio block answers from the now-playing line', () => {
  const src = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /if \(radio === 'whats-playing'\) return \{ say: playingSay\(nowPlaying\(\), mediaState\(\)\)/);
});
