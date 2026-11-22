// Temperature questions by voice (src/core/web/voice-weather.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { temperatureDay } from '../src/core/web/voice-weather.ts';

test('a question about the temperature now is about today', () => {
  assert.equal(temperatureDay("what's the temperature"), 0);
  assert.equal(temperatureDay('how cold is it outside'), 0);
  assert.equal(temperatureDay('is it hot outside'), 0);
  assert.equal(temperatureDay('do i need a jacket'), 0);
});

test('a question about the temperature tomorrow is about tomorrow', () => {
  assert.equal(temperatureDay("what's the temperature tomorrow"), 1);
  assert.equal(temperatureDay('do i need a coat tomorrow'), 1);
});

test('anything else is not a temperature question', () => {
  assert.equal(temperatureDay("what's the weather"), null);
  assert.equal(temperatureDay('what time is it'), null);
  assert.equal(temperatureDay('is it hot in my coffee'), null);
});
