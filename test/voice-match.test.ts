// Voice matching for Home (on and off, scenes) and for the lists: it must never guess. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchHome, matchScene, onOffReply, parseOnOff, sayName, type VoiceDevice } from '../src/apps/home-assistant/web/voice-match.ts';
import { matchList } from '../src/apps/lists/web/voice-match.ts';

const kitchen: VoiceDevice = { entity_id: 'light.kitchen', domain: 'light', name: 'Kitchen' };
const bedroomFan: VoiceDevice = { entity_id: 'fan.bedroom', domain: 'fan', name: 'Bedroom' };
const coffee: VoiceDevice = { entity_id: 'switch.coffee', domain: 'switch', name: 'Coffee machine' };
const dashboard = [kitchen, bedroomFan, coffee];

test('an on or off phrase is read into its target', () => {
  assert.deepEqual(parseOnOff('turn off the kitchen light'), { on: false, target: 'the kitchen light' });   // matchHome drops "the"
  assert.deepEqual(parseOnOff('switch the fan on'), { on: true, target: 'the fan' });
  assert.deepEqual(parseOnOff('lights on'), { on: true, target: 'lights' });
  assert.equal(parseOnOff('turn on'), null);
  assert.equal(parseOnOff('turn off it'), null);
  assert.equal(parseOnOff('what time is it'), null);
});

test('a device is matched by its name, with or without its kind word', () => {
  assert.deepEqual(matchHome('turn off the kitchen light', dashboard)?.targets.map(d => d.entity_id), ['light.kitchen']);
  assert.equal(matchHome('turn off the kitchen light', dashboard)?.on, false);
  assert.deepEqual(matchHome('turn on the coffee machine', dashboard)?.targets.map(d => d.entity_id), ['switch.coffee']);
});

test('"lights off" means every light on the dashboard, and says so', () => {
  const m = matchHome('lights off', dashboard);
  assert.ok(m);
  assert.equal(m?.all, true);
  assert.deepEqual(m?.targets.map(d => d.entity_id), ['light.kitchen']);
});

test('when the PC cannot be reached for a device, the reply says so and gives no device fault', () => {
  const m = matchHome('turn off the kitchen light', dashboard);
  assert.ok(m);
  assert.deepEqual(onOffReply(m!, [null]), { say: 'I can’t reach the PC right now.' });
});

test('a refusal from the PC gives its plain reason, not a generic device failure', () => {
  const m = matchHome('turn off the kitchen light', dashboard);
  assert.ok(m);
  assert.deepEqual(onOffReply(m!, [{ ok: false, error: 'HTTP 401 unauthorized' }]),
    { say: 'Couldn’t turn off the kitchen light. The access token was refused. Replace it in Settings, then Apps, then Home Assistant.' });
});

test('a partial all-lights failure keeps the count of lights that were not reached', () => {
  const lights = [
    { entity_id: 'light.kitchen', domain: 'light', name: 'Kitchen' },
    { entity_id: 'light.hall', domain: 'light', name: 'Hall' },
  ];
  const m = matchHome('lights off', lights);
  assert.ok(m);
  assert.deepEqual(onOffReply(m!, [{ ok: true }, null]), { say: 'Couldn’t reach 1 of the lights.' });
  assert.deepEqual(onOffReply(m!, [{ ok: true }, { ok: true }]), { say: 'Lights off.', react: 'look' });
});

test('a bare "turn on" matches nothing', () => {
  assert.equal(matchHome('turn on', dashboard), null);
});

test('two devices with the same name are not guessed between', () => {
  const twins = [
    { entity_id: 'light.a', domain: 'light', name: 'Kitchen' },
    { entity_id: 'light.b', domain: 'light', name: 'Kitchen' },
  ];
  assert.equal(matchHome('turn off the kitchen light', twins), null);
});

test('a device that is not on the dashboard is not matched', () => {
  assert.equal(matchHome('turn off the kitchen light', [bedroomFan]), null);
});

test('the phrase spoken back names the device with its kind', () => {
  assert.equal(sayName(kitchen), 'Kitchen light');
  assert.equal(sayName({ entity_id: 'light.k', domain: 'light', name: 'Kitchen light' }), 'Kitchen light');
  assert.equal(sayName(bedroomFan), 'Bedroom fan');
});

test('a scene is matched by its exact name, and two of the same name are not guessed', () => {
  const scenes = [{ entity_id: 'scene.movie_night', name: 'Movie night' }];
  assert.equal(matchScene('set movie night', scenes)?.entity_id, 'scene.movie_night');
  assert.equal(matchScene('activate the movie night scene', scenes)?.entity_id, 'scene.movie_night');
  const twins = [
    { entity_id: 'scene.a', name: 'Movie night' },
    { entity_id: 'scene.b', name: 'Movie night' },
  ];
  assert.equal(matchScene('set movie night', twins), null);
});

test('list commands: add an item, or read a list; anything else is left to Claude', () => {
  assert.deepEqual(matchList('add some milk to the shopping list'), { op: 'add', list: 'shopping', text: 'Milk' });
  assert.deepEqual(matchList('put bin day on my to-do list'), { op: 'add', list: 'todo', text: 'Bin day' });
  assert.deepEqual(matchList("what's on the shopping list"), { op: 'read', list: 'shopping' });
  assert.deepEqual(matchList('tick off milk on the shopping list'), { op: 'tick', list: 'shopping', text: 'Milk' });
  assert.deepEqual(matchList('cross off bin day from my to-do list'), { op: 'tick', list: 'todo', text: 'Bin day' });
  assert.equal(matchList('tick off on the shopping list'), null);   // no item named
  assert.equal(matchList('add to shopping list'), null);          // no item
  assert.equal(matchList('add it to the shopping list'), null);   // "it" is not an item
  assert.equal(matchList('turn off the kitchen light'), null);
});
