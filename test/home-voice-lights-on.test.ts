// "Are any lights on" by voice (src/apps/home-assistant/web/voice-match.ts). The read is in voice-commands.ts (read as source).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lightsOnReply, parseLightsOn } from '../src/apps/home-assistant/web/voice-match.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the lights questions are heard: any on, which are on, and all off', () => {
  assert.equal(parseLightsOn('are any lights on'), 'any-on');
  assert.equal(parseLightsOn('are any lights still on'), 'any-on');
  assert.equal(parseLightsOn('which lights are on'), 'any-on');
  assert.equal(parseLightsOn('what lights are on'), 'any-on');
  assert.equal(parseLightsOn('are the lights all off'), 'all-off');
  assert.equal(parseLightsOn('are all the lights off'), 'all-off');
});

test('a pronoun, a single light, and other device questions are not the lights question', () => {
  assert.equal(parseLightsOn('is it on'), null);
  assert.equal(parseLightsOn('are they on'), null);
  assert.equal(parseLightsOn('is the porch light on'), null);
  assert.equal(parseLightsOn('turn on the lights'), null);
});

test('no light on, one on, several on, and many on are each said in words', () => {
  const all = ['Kitchen light', 'Porch light', 'Hall light'];
  assert.equal(lightsOnReply('any-on', all, []), 'No lights are on.');
  assert.equal(lightsOnReply('any-on', all, ['Porch light']), 'The Porch light is on.');
  assert.equal(lightsOnReply('any-on', all, ['Kitchen light', 'Porch light']), 'The Kitchen light and Porch light are on.');
  const many = ['A', 'B', 'C', 'D', 'E'];
  assert.equal(lightsOnReply('any-on', many, many), 'The A, B, C, and 2 more are on.');
});

test('all off says so, and names any light still on', () => {
  const all = ['Kitchen light', 'Porch light'];
  assert.equal(lightsOnReply('all-off', all, []), 'All the lights are off.');
  assert.equal(lightsOnReply('all-off', all, ['Porch light']), 'No, Porch light is still on.');
  assert.equal(lightsOnReply('all-off', [], []), 'There are no lights.');
});

test('the read is the dashboard read with the missing devices left out, and a failed read is left to the next step', () => {
  assert.ok(voice.includes("const lights = dash.entities.filter(e => !e.missing && e.domain === 'light');"));
  assert.ok(voice.includes("if (!dash?.layout || !Array.isArray(dash.entities)) return null;"));
  assert.ok(voice.includes('const lightsAsked = await homeLightsOn(raw);'));
});
