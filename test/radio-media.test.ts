// Radio's drawer card: Radio registers its station, its state and its buttons with the media session.
// Skip needs favourites; stop is always offered while a station plays. Source-text checks on index.ts, plus the bar model.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { barModel } from '../src/apps/radio/web/player.ts';
import type { Station } from '../src/apps/radio/api.ts';

const src = readFileSync(new URL('../src/apps/radio/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('function syncMedia(): void {');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('Radio registers its station, state and buffering flag with the media card', () => {
  assert.ok(start >= 0, 'syncMedia exists');
  assert.match(body, /setNowPlaying\(info\)/);
  assert.match(body, /buffering: m\.buffering/);
});

test('Radio offers play or pause and stop while a station plays', () => {
  assert.match(body, /setMediaActions\(info \? \{ toggle, stop,/);
  assert.match(body, /: null\);/, 'the buttons are cleared when nothing plays');
});

test('Radio offers skip only when favourites allow it', () => {
  assert.match(body, /m\.canStep \? \{ next: \(\) => step\(1\), prev: \(\) => step\(-1\) \} : \{\}/);
});

test('the bar model reports buffering apart from playing', () => {
  const st = (id: string): Station => ({ id, name: `Station ${id}`, url: `https://${id}.example/s`, country: '', codec: '', bitrate: 0 });
  const buffering = barModel(st('a'), 'buffering', '', []);
  assert.equal(buffering.buffering, true);
  assert.equal(buffering.playing, true);
  const playing = barModel(st('a'), 'playing', '', []);
  assert.equal(playing.buffering, false);
  assert.equal(barModel(null, 'off', '', []).live, false);
});
