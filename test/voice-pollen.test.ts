// The pollen count by voice (src/core/web/voice-weather.ts, wired in src/core/web/voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { pollenSay, pollenWord } from '../src/core/web/voice-weather.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('pollen questions are matched, with or without "count" or "today"', () => {
  assert.equal(pollenWord("what's the pollen count"), true);
  assert.equal(pollenWord('what is the pollen today'), true);
  assert.equal(pollenWord('how much pollen is there today'), true);
  assert.equal(pollenWord('is the pollen high today'), true);
});

test('other air questions are not pollen questions', () => {
  assert.equal(pollenWord("what's the air quality"), false);
  assert.equal(pollenWord('is the air good'), false);
});

test('the answer lists the pollen types, rounded, as the Weather screen does', () => {
  assert.equal(pollenSay([{ name: 'grass', value: 12.4 }, { name: 'birch', value: 3 }]), 'Pollen: grass 12 · birch 3 grains per cubic metre.');
});

test('no pollen types says there is no count here, and no air block says it cannot be read', () => {
  assert.equal(pollenSay([]), 'There’s no pollen count here.');
  assert.equal(pollenSay(null), 'I can’t get the pollen count right now.');
});

test('the pollen question reads the forecast’s air block, and is routed after the air question', () => {
  assert.ok(voice.includes('async function pollenCommand(): Promise<CommandResult> {'));
  assert.ok(voice.includes('pollenSay(w.air ? (w.air.pollen ?? []) : null)'));
  assert.ok(voice.indexOf('if (airWord(t)) return airCommand();') < voice.indexOf('if (pollenWord(t)) return pollenCommand();'));
});
