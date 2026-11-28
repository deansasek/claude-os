// Do Not Disturb by voice (src/core/web/voice-dnd.ts). The command sets the flag (read as source). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dndWord } from '../src/core/web/voice-dnd.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('turning Do Not Disturb on and off is heard, in the usual wordings', () => {
  assert.equal(dndWord('turn on do not disturb'), 'on');
  assert.equal(dndWord('turn on do not disturb mode'), 'on');
  assert.equal(dndWord('do not disturb on'), 'on');
  assert.equal(dndWord('turn off do not disturb'), 'off');
  assert.equal(dndWord('switch off dnd'), 'off');
  assert.equal(dndWord('do not disturb off'), 'off');
});

test('asking whether it is on is read only', () => {
  assert.equal(dndWord('is do not disturb on'), 'ask');
  assert.equal(dndWord('is do not disturb off'), 'ask');
});

test('other phrases are not about Do Not Disturb', () => {
  assert.equal(dndWord('turn on the lights'), null);
  assert.equal(dndWord('do not disturb me'), null);
  assert.equal(dndWord('dark mode'), null);
});

test('the command sets the same flag the Control Center tile sets, and says when it is already that way', () => {
  assert.ok(voice.includes('const dnd = dndWord(t);'));
  assert.ok(voice.includes('prefs.dnd = want;'));
  assert.ok(voice.includes('`Do Not Disturb is already ${want ? \'on\' : \'off\'}.`'));
});
