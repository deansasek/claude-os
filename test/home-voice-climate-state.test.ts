// "Is the thermostat on" says the thermostat's mode in plain words, as its tile does (src/apps/home-assistant/web/voice-match.ts).
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stateReply, type VoiceDevice } from '../src/apps/home-assistant/web/voice-match.ts';

const thermostat: VoiceDevice = { entity_id: 'climate.hall', domain: 'climate', name: 'Thermostat' };
const light: VoiceDevice = { entity_id: 'light.porch', domain: 'light', name: 'Porch light' };

test('a thermostat says its mode in plain words, as the tile does', () => {
  assert.equal(stateReply(thermostat, 'heat'), 'The thermostat is heating.');
  assert.equal(stateReply(thermostat, 'heat_cool'), 'The thermostat is auto.');
  assert.equal(stateReply(thermostat, 'fan_only'), 'The thermostat is fan only.');
  assert.equal(stateReply(thermostat, 'off'), 'The thermostat is off.');
});

test('other devices keep their words', () => {
  assert.equal(stateReply(light, 'on'), 'The porch light is on.');
});
