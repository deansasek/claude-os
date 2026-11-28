// "Next station" and "previous station" by voice (src/core/web/voice-radio.ts, wired in voice-commands.ts and
// src/apps/radio/web/index.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { radioWord } from '../src/core/web/voice-radio.ts';
import { canStepFavourites, stepFavourite } from '../src/apps/radio/web/player.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const radioApp = readFileSync(new URL('../src/apps/radio/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('next and skip phrases are heard as the next favourite', () => {
  assert.equal(radioWord('next station'), 'next');
  assert.equal(radioWord('next radio station'), 'next');
  assert.equal(radioWord('skip station'), 'next');
  assert.equal(radioWord('skip the radio'), 'next');
  assert.equal(radioWord('play the next station'), 'next');
});

test('previous phrases are heard as the previous favourite', () => {
  assert.equal(radioWord('previous station'), 'prev');
  assert.equal(radioWord('previous radio station'), 'prev');
  assert.equal(radioWord('play the previous station'), 'prev');
});

test('other radio phrases keep their words', () => {
  assert.equal(radioWord('play the radio'), 'play');
  assert.equal(radioWord('stop the radio'), 'stop');
  assert.equal(radioWord('next'), null);
  assert.equal(radioWord('play radio 2'), null);
});

test('stepping needs two or more favourites, and wraps at both ends', () => {
  assert.equal(canStepFavourites([]), false);
  assert.equal(canStepFavourites([{ id: 'a' }]), false);
  assert.equal(canStepFavourites([{ id: 'a' }, { id: 'b' }]), true);
  const favs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never[];
  assert.equal((stepFavourite(favs, 'c', 1) as unknown as { id: string }).id, 'a');
  assert.equal((stepFavourite(favs, 'a', -1) as unknown as { id: string }).id, 'c');
});

test('the voice step dispatches hub:radio-step only with two favourites, and the Radio app steps on it', () => {
  assert.ok(voice.includes("if (!canStepFavourites(favs)) return { say: 'Save two or more favourite stations in the Radio app to step between them.', app: 'radio' };"));
  assert.ok(voice.includes("dispatchEvent(new CustomEvent('hub:radio-step', { detail: radio === 'next' ? 1 : -1 }));"));
  assert.ok(radioApp.includes("addEventListener('hub:radio-step', (e) => { const dir = (e as CustomEvent<1 | -1>).detail; if (dir === 1 || dir === -1) step(dir); });"));
});
