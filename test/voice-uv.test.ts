// UV index by voice (src/core/web/voice-weather.ts, wired in src/core/web/voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { uvSay, uvWord } from '../src/core/web/voice-weather.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('UV questions are matched, with or without "today" or "right now"', () => {
  assert.equal(uvWord("what's the uv index"), true);
  assert.equal(uvWord('what is the uv index today'), true);
  assert.equal(uvWord("what's the uv"), true);
  assert.equal(uvWord('how strong is the sun today'), true);
  assert.equal(uvWord('is the uv high today'), true);
});

test('other weather questions are not UV questions', () => {
  assert.equal(uvWord('how humid is it'), false);
  assert.equal(uvWord('is it sunny'), false);
  assert.equal(uvWord("what's the uv index in paris"), false);
});

test('the answer rounds the day’s maximum and reads as the Weather tip does', () => {
  assert.equal(uvSay(6), 'UV index 6 today.');
  assert.equal(uvSay(5.6), 'UV index 6 today.');
});

test('no UV index from the forecast says it is not available', () => {
  assert.equal(uvSay(null), 'I can’t get the UV index right now.');
  assert.equal(uvSay(undefined), 'I can’t get the UV index right now.');
});

test('the UV phrase is routed to uvCommand after the humidity phrase', () => {
  assert.ok(voice.includes('async function uvCommand(): Promise<CommandResult> {'));
  assert.ok(voice.indexOf('if (humidWord(t)) return humidCommand();') < voice.indexOf('if (uvWord(t)) return uvCommand();'));
  assert.ok(voice.includes("uvSay(w.daily.uv_index_max?.[0])"));
});
