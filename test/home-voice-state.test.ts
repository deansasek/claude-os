// "Is the porch light on" reads a dashboard device's state and never switches it (src/apps/home-assistant/web/voice-match.ts,
// src/core/web/voice-commands.ts). The command handler needs the browser, so it is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseIsOn, stateReply } from '../src/apps/home-assistant/web/voice-match.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('an is-or-are question about a device is heard, with the state asked about', () => {
  assert.deepEqual(parseIsOn('is the porch light on'), { target: 'porch light', word: 'on' });
  assert.deepEqual(parseIsOn('is the front door open'), { target: 'front door', word: 'open' });
  assert.deepEqual(parseIsOn('are the lights off'), { target: 'lights', word: 'off' });
});

test('a pronoun, a question about something else, or no device is not a device question', () => {
  assert.equal(parseIsOn('is it on'), null);
  assert.equal(parseIsOn('is milk on the shopping list'), null);
  assert.equal(parseIsOn('is the stopwatch running'), null);
});

test('the reply says the device and its state, in words', () => {
  assert.equal(stateReply({ entity_id: 'light.porch', domain: 'light', name: 'Porch light' }, 'on'), 'The porch light is on.');
  assert.equal(stateReply({ entity_id: 'binary_sensor.front_door', domain: 'binary_sensor', name: 'Front door' }, 'open'), 'The front door is open.');
});

test('the voice reads the state and does not switch the device', () => {
  assert.match(voice, /const asked = homeState\(raw\);/);
  assert.match(voice, /return \{ say: stateReply\(d, entity\.state\), react: 'look' \};/);
  assert.doesNotMatch(voice.slice(voice.indexOf('async function homeState('), voice.indexOf('async function homeOnOff(')), /toggle/);
});
