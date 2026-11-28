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

test('the Now line gives the humidity and the wind, and leaves out a missing one', async () => {
  const day = { time: ['2026-11-28'], temperature_2m_max: [10], temperature_2m_min: [4], weather_code: [3], precipitation_probability_max: [20], wind_speed_10m_max: [12], sunrise: ['2026-11-28T07:10'], sunset: ['2026-11-28T16:20'], uv_index_max: [1] };
  const base = { status: 'ok' as const, place: 'Testville', units: 'celsius', wind_unit: 'km/h', daily: day };
  const full = await weatherForecast({ days: 1 }, async () => ({ ...base, current: { temperature_2m: 9.6, weather_code: 3, apparent_temperature: 7.2, relative_humidity_2m: 71.4, wind_speed_10m: 13.2 } }) as any);
  assert.match(full.content[0].text, /Now 10°C, cloudy, feels like 7°C, humidity 71%, wind 13 km\/h\./);
  const bare = await weatherForecast({ days: 1 }, async () => ({ ...base, current: { temperature_2m: 9.6, weather_code: 3, apparent_temperature: 7.2 } }) as any);
  assert.match(bare.content[0].text, /Now 10°C, cloudy, feels like 7°C\.\n/);
});
