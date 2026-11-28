// A device name with its capitals kept, in the Home Assistant voice replies (src/apps/home-assistant/web/voice-match.ts).
// The reply code is read as source for the on/off reply. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { stateReply } from '../src/apps/home-assistant/web/voice-match.ts';

const src = readFileSync(new URL('../src/apps/home-assistant/web/voice-match.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a device called TV or LED strip keeps its capitals in the state reply', () => {
  assert.equal(stateReply({ entity_id: 'media_player.tv', domain: 'media_player', name: 'TV' }, 'on'), 'The TV is on.');
  assert.equal(stateReply({ entity_id: 'light.led', domain: 'light', name: 'LED strip' }, 'on'), 'The LED strip light is on.');
});

test('an ordinary name still starts in lower case mid-sentence', () => {
  assert.equal(stateReply({ entity_id: 'light.porch', domain: 'light', name: 'Porch light' }, 'on'), 'The porch light is on.');
});

test('the on/off reply and the state reply both use the same first-letter rule', () => {
  assert.ok(src.includes('const subject = m.all ? \'the lights\' : `the ${lowerFirst(sayName(m.targets[0]))}`;'));
  assert.ok(src.includes('const name = lowerFirst(sayName(d));'));
  assert.equal(src.includes('.replace(/^./, c => c.toLowerCase())'), false);
});
