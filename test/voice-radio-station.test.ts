// "Play Radio 2" by voice (src/core/web/voice-radio.ts). The play is in voice-commands.ts and radio/web/index.ts (read as source).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { matchStation, stationWord } from '../src/core/web/voice-radio.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const radio = readFileSync(new URL('../src/apps/radio/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// the Station fields matchStation reads
const st = (id: string, name: string) => ({ id, name, url: 'https://x.example/s', country: '', codec: '', bitrate: 0 });

test('"play Radio 2" and "put on Jazz FM on the radio" give the station name', () => {
  assert.equal(stationWord('play radio 2'), 'radio 2');
  assert.equal(stationWord('put on jazz fm on the radio'), 'jazz fm');
  assert.equal(stationWord('tune to classic fm'), 'classic fm');
});

test('"play the radio" and other phrases are not a station request', () => {
  assert.equal(stationWord('play the radio'), null);
  assert.equal(stationWord('play my radio'), null);
  assert.equal(stationWord('stop the radio'), null);
  assert.equal(stationWord('what’s playing'), null);
});

test('a saved station matches by name, in any case, and a duplicate is not a second station', () => {
  const saved = [st('1', 'Radio 2'), st('2', 'Jazz FM')];
  assert.equal(matchStation('radio 2', saved)?.id, '1');
  assert.equal(matchStation('JAZZ FM', saved)?.id, '2');
  // the same station in favourites and recent is still one station
  assert.equal(matchStation('radio 2', [...saved, st('1', 'Radio 2')])?.id, '1');
});

test('no station, or two different stations with that name, match nothing: it never guesses', () => {
  assert.equal(matchStation('radio 4', [st('1', 'Radio 2')]), null);
  assert.equal(matchStation('radio 2', [st('1', 'Radio 2'), st('3', 'Radio 2')]), null);
});

test('the voice plays the matched station through hub:radio-play, and the radio app listens for it', () => {
  assert.ok(voice.includes("new CustomEvent('hub:radio-play', { detail: hit })"));
  assert.ok(voice.includes("store.get('radio.favs')"));
  assert.ok(radio.includes("addEventListener('hub:radio-play'"));
});
