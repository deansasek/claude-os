// "Play Jazz FM" while another station plays switches to it (src/core/web/voice-radio.ts, wired in voice-commands.ts).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isSameStation } from '../src/core/web/voice-radio.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const jazz = { id: 'jazz', name: 'Jazz FM', url: 'https://example.test/jazz' } as never;

test('the station playing is the same one only when its name matches, in any case', () => {
  assert.equal(isSameStation('Jazz FM', jazz), true);
  assert.equal(isSameStation('jazz fm ', jazz), true);
  assert.equal(isSameStation('Radio 2', jazz), false);
});

test('nothing playing, or no title, is not the same station', () => {
  assert.equal(isSameStation(undefined, jazz), false);
  assert.equal(isSameStation('', jazz), false);
});

test('only the same station is refused as already playing; another station is played', () => {
  assert.ok(voice.includes('const already = isSameStation(np?.title, hit) ? alreadyPlayingSay(np, mediaState()) : null;'));
  assert.ok(voice.includes("dispatchEvent(new CustomEvent('hub:radio-play', { detail: hit }));"));
});
