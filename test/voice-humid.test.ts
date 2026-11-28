// Humidity by voice (src/core/web/voice-weather.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { humidSay, humidWord } from '../src/core/web/voice-weather.ts';

test('humidity questions are matched, with or without "today" or "outside"', () => {
  assert.equal(humidWord('how humid is it'), true);
  assert.equal(humidWord('how humid is it outside'), true);
  assert.equal(humidWord("what's the humidity"), true);
  assert.equal(humidWord('what is the humidity right now'), true);
  assert.equal(humidWord('is it humid today'), true);
});

test('other weather questions are not humidity questions', () => {
  assert.equal(humidWord('is it windy'), false);
  assert.equal(humidWord("what's the humidity in paris"), false);
  assert.equal(humidWord('how cold is it'), false);
});

test('the answer gives the relative humidity as a whole percent', () => {
  assert.equal(humidSay(71), 'Humidity is 71 percent.');
  assert.equal(humidSay(40.6), 'Humidity is 41 percent.');
});

test('no humidity from the forecast says it is not available', () => {
  assert.equal(humidSay(null), 'I can’t get the humidity right now.');
});
