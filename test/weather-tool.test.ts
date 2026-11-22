// The weather tool's sky words, from the weather codes Open-Meteo sends. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { skyWords } from '../src/apps/weather/server/tools.ts';

test('a weather code becomes a plain sky word', () => {
  assert.equal(skyWords(0), 'clear');
  assert.equal(skyWords(2), 'partly cloudy');
  assert.equal(skyWords(45), 'fog');
  assert.equal(skyWords(63), 'rain');
  assert.equal(skyWords(73), 'snow');
  assert.equal(skyWords(81), 'showers');
  assert.equal(skyWords(95), 'thunderstorms');
});
