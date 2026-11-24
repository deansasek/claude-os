// The Radio player's pure choices: the next and previous favourite, the title line, the glance, the volume.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Station } from '../src/apps/radio/api.ts';
import { readFileSync } from 'node:fs';
import { initial, railLabel, stationHue, stepFavourite, titleLine, volumeFrom, volumeFromDevice, canStepFavourites, barModel } from '../src/apps/radio/web/player.ts';

const st = (id: string): Station => ({ id, name: `Station ${id}`, url: `https://${id}.example/s`, country: '', codec: '', bitrate: 0 });
const favs = [st('a'), st('b'), st('c')];

test('next and previous step through the favourites and wrap around', () => {
  assert.equal(stepFavourite(favs, 'a', 1)?.id, 'b');
  assert.equal(stepFavourite(favs, 'c', 1)?.id, 'a');
  assert.equal(stepFavourite(favs, 'b', -1)?.id, 'a');
  assert.equal(stepFavourite(favs, 'a', -1)?.id, 'c');
});

test('a station outside the favourites starts at the ends; no favourites gives nothing', () => {
  assert.equal(stepFavourite(favs, 'zz', 1)?.id, 'a');
  assert.equal(stepFavourite(favs, null, -1)?.id, 'c');
  assert.equal(stepFavourite([st('x')], 'x', 1)?.id, 'x');
  assert.equal(stepFavourite([], 'a', 1), null);
});

test('the title line shows the stream title, or the state', () => {
  assert.equal(titleLine(false, 'off'), 'Pick a station to listen');
  assert.equal(titleLine(true, 'buffering'), 'Tuning in…');
  assert.equal(titleLine(true, 'paused'), 'Paused');
  assert.equal(titleLine(true, 'off'), 'Stopped');
  assert.equal(titleLine(true, 'playing'), 'Live radio');
  assert.equal(titleLine(true, 'playing', '  '), 'Live radio');
  assert.equal(titleLine(true, 'playing', ' Miles Davis – So What '), 'Miles Davis – So What');
});

test('the rail shows the station on the air, else the app name', () => {
  assert.equal(railLabel(st('a'), 'playing', 'Radio'), 'Station a');
  assert.equal(railLabel(st('a'), 'off', 'Radio'), 'Radio');
  assert.equal(railLabel(null, 'off', 'Radio'), 'Radio');
});

test('the colour block is steady and the volume is 0 to 100', () => {
  assert.equal(stationHue('Jazz FM'), stationHue('Jazz FM'));
  assert.equal(initial('  1Live'), '1');
  assert.equal(initial('***'), '·');
  assert.equal(volumeFrom('35'), 35);
  assert.equal(volumeFrom('250'), 100);
  assert.equal(volumeFrom(-4), 0);
  assert.equal(volumeFrom(null), 80);
  assert.equal(volumeFrom('loud'), 80);
});

test('the device media level (0..1) maps to the slider 0..100; a missing level is null', () => {
  assert.equal(volumeFromDevice(0.35), 35);
  assert.equal(volumeFromDevice(1.4), 100);
  assert.equal(volumeFromDevice(-0.2), 0);
  assert.equal(volumeFromDevice(undefined), null);
  assert.equal(volumeFromDevice(''), null);
  assert.equal(volumeFromDevice('loud'), null);
});

test('the old radio.volume store key is ignored: radio no longer reads it', () => {
  const src = readFileSync(new URL('../src/apps/radio/web/index.ts', import.meta.url), 'utf8');
  assert.equal(src.includes('radio.volume'), false);
});

test('next and previous need two or more favourites', () => {
  assert.equal(canStepFavourites([]), false);
  assert.equal(canStepFavourites([st('a')]), false);
  assert.equal(canStepFavourites(favs), true);
});

test('the bar model: idle shows the blank line; buffering and playing carry the title line', () => {
  const idle = barModel(null, 'off', '', []);
  assert.deepEqual(idle, { title: 'Nothing playing', subtitle: 'Pick a station to listen', art: '', playing: false, canStep: false, live: false });
  const buffering = barModel(st('a'), 'buffering', '', favs);
  assert.equal(buffering.subtitle, 'Tuning in…');
  assert.equal(buffering.playing, true);
  assert.equal(buffering.live, true);
  const playing = barModel(st('a'), 'playing', ' Miles Davis – So What ', favs);
  assert.equal(playing.title, 'Station a');
  assert.equal(playing.subtitle, 'Miles Davis – So What');
  assert.equal(playing.playing, true);
});

test('the bar model is not live after Stop, and steps only with two favourites', () => {
  const stopped = barModel(st('a'), 'off', '', favs);
  assert.equal(stopped.live, false);
  assert.equal(stopped.subtitle, 'Stopped');
  assert.equal(barModel(st('a'), 'paused', '', [st('a')]).canStep, false);
  assert.equal(barModel(st('a'), 'paused', '', [st('a'), st('b')]).canStep, true);
});
