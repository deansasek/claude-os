// "What's the low tonight" by voice (src/core/web/voice-weather.ts and voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lowTonightSay, lowTonightWord } from '../src/core/web/voice-weather.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the overnight low questions are matched, with the common phrasings', () => {
  assert.equal(lowTonightWord('how cold will it get tonight'), true);
  assert.equal(lowTonightWord('how cold is it going to get tonight'), true);
  assert.equal(lowTonightWord("what's the low tonight"), true);
  assert.equal(lowTonightWord('what is the low temperature tonight'), true);
  assert.equal(lowTonightWord('how low will it go tonight'), true);
});

test('questions for tomorrow, frost, and other weather are not the overnight low', () => {
  assert.equal(lowTonightWord("what's the temperature tomorrow"), false);
  assert.equal(lowTonightWord('will it freeze tonight'), false);
  assert.equal(lowTonightWord('how cold is it'), false);
});

test('the low is said as a whole number of degrees', () => {
  assert.equal(lowTonightSay(28.4), 'Down to 28 degrees tonight.');
  assert.equal(lowTonightSay(-2), 'Down to -2 degrees tonight.');
});

test('the frost and low answers share the overnight fetch', () => {
  assert.ok(voice.includes('if (lowTonightWord(t)) return overnightCommand((low) => lowTonightSay(low));'));
  assert.ok(voice.includes('return overnightCommand(frostSay);'));
});
