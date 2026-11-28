// "What does it feel like outside" by voice (src/core/web/voice-weather.ts, wired in src/core/web/voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { feelsSay, feelsWord } from '../src/core/web/voice-weather.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('feels-like questions are matched, with or without "outside" or "right now"', () => {
  assert.equal(feelsWord('what does it feel like outside'), true);
  assert.equal(feelsWord('what does it feel like'), true);
  assert.equal(feelsWord('how does it feel outside'), true);
  assert.equal(feelsWord("what's the feels like"), true);
  assert.equal(feelsWord('what is the feels like right now'), true);
  assert.equal(feelsWord('how cold does it feel outside'), true);
});

test('other weather questions are not feels-like questions', () => {
  assert.equal(feelsWord('how cold is it'), false);
  assert.equal(feelsWord('what does it feel like in paris'), false);
  assert.equal(feelsWord('how humid is it'), false);
});

test('the answer says the apparent temperature with the degree words', () => {
  assert.equal(feelsSay(3), 'It feels like 3 degrees.');
  assert.equal(feelsSay(1), 'It feels like 1 degree.');
  assert.equal(feelsSay(-2.4), 'It feels like -2 degrees.');
});

test('no apparent temperature from the forecast says it is not available', () => {
  assert.equal(feelsSay(null), 'I can’t get how it feels right now.');
  assert.equal(feelsSay(undefined), 'I can’t get how it feels right now.');
});

test('the feels-like phrase is routed to feelsCommand after the UV phrase', () => {
  assert.ok(voice.includes('async function feelsCommand(): Promise<CommandResult> {'));
  assert.ok(voice.indexOf('if (uvWord(t)) return uvCommand();') < voice.indexOf('if (feelsWord(t)) return feelsCommand();'));
  assert.ok(voice.includes('feelsSay(w.current?.apparent_temperature)'));
});
