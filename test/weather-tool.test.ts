// The weather tool's sky words, from the weather codes Open-Meteo sends. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { skyWords, weatherForecast } from '../src/apps/weather/server/tools.ts';

test('a weather code becomes a plain sky word', () => {
  assert.equal(skyWords(0), 'clear');
  assert.equal(skyWords(2), 'partly cloudy');
  assert.equal(skyWords(45), 'fog');
  assert.equal(skyWords(63), 'rain');
  assert.equal(skyWords(73), 'snow');
  assert.equal(skyWords(81), 'showers');
  assert.equal(skyWords(95), 'thunderstorms');
});

test('a failed forecast read gives the plain message, not the raw error', async () => {
  const reply = await weatherForecast({}, async () => { throw new Error('fetch failed'); });
  assert.equal(reply.isError, true);
  assert.equal(reply.content[0].text, 'The weather couldn’t be read just now. Try again in a little while.');
  assert.ok(!reply.content[0].text.includes('fetch failed'));
});

test('a sky word matches the Weather app: mostly clear, cloudy, freezing drizzle', () => {
  assert.equal(skyWords(1), 'mostly clear');
  assert.equal(skyWords(3), 'cloudy');
  assert.equal(skyWords(56), 'freezing drizzle');
  assert.equal(skyWords(999), 'cloudy');
});
