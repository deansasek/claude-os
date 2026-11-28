// "Is the front door open" is answered open or closed, for a door sensor too (src/apps/home-assistant/web/voice-match.ts).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { findDevice, stateReply, type VoiceDevice } from '../src/apps/home-assistant/web/voice-match.ts';

const door: VoiceDevice = { entity_id: 'binary_sensor.front_door', domain: 'binary_sensor', name: 'Front door' };
const light: VoiceDevice = { entity_id: 'light.porch', domain: 'light', name: 'Porch light' };

test('a door sensor reads on as open and off as closed', () => {
  assert.equal(stateReply(door, 'on'), 'The front door is open.');
  assert.equal(stateReply(door, 'off'), 'The front door is closed.');
});

test('other devices keep their words', () => {
  assert.equal(stateReply(light, 'on'), 'The porch light is on.');
});

test('a question finds its device in any domain, and a name that matches nothing or two devices finds none', () => {
  assert.equal(findDevice('front door', [door, light])?.entity_id, 'binary_sensor.front_door');
  assert.equal(findDevice('porch light', [door, light])?.entity_id, 'light.porch');
  assert.equal(findDevice('garage', [door, light]), null);
  assert.equal(findDevice('door', [door, { ...door, entity_id: 'binary_sensor.door_2' }]), null);
});

test('the state question uses findDevice, not the on-off matcher that keeps only the voice domains', () => {
  const src = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8');
  assert.ok(src.includes('const d = findDevice(q.target, list);'));
});
