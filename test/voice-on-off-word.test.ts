// "Turn do not disturb on", "turn dark mode on": the on or off word at the end is heard (src/core/web/voice-dnd.ts,
// and the theme lines in src/core/web/voice-commands.ts, read as source). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dndWord } from '../src/core/web/voice-dnd.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('do not disturb is turned on or off with the word at the end too', () => {
  assert.equal(dndWord('turn do not disturb on'), 'on');
  assert.equal(dndWord('switch dnd off'), 'off');
  assert.equal(dndWord('turn do not disturb mode on'), 'on');
  assert.equal(dndWord('turn on do not disturb'), 'on');
  assert.equal(dndWord('turn off dnd'), 'off');
});

test('the dark and light mode lines hear the on or off word at the end', () => {
  assert.ok(voice.includes("|^(?:turn|switch) (?:the )?(?:dark|night) (?:mode|theme) on$|"));
  assert.ok(voice.includes("|^(?:turn|switch) (?:the )?(?:light|day) (?:mode|theme) off$/.test(t)) { setThemeMode('dark');"));
  assert.ok(voice.includes("|^(?:turn|switch) (?:the )?(?:light|day) (?:mode|theme) on$|"));
});
