// Claude's weather_forecast rows give each day's sunrise, sunset and UV index (src/apps/weather/server/tools.ts).
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hourMinute, weatherForecast } from '../src/apps/weather/server/tools.ts';

test('a forecast row gives the day’s sunrise, sunset and UV index', async () => {
  const day = { time: ['2026-11-28'], temperature_2m_max: [8], temperature_2m_min: [1], weather_code: [0], precipitation_probability_max: [10],
    wind_speed_10m_max: [12], uv_index_max: [2.4], sunrise: ['2026-11-28T07:12'], sunset: ['2026-11-28T16:21'] };
  const fake = async () => ({ status: 'ok', place: 'Leeds', units: 'celsius', wind_unit: 'km/h',
    current: { temperature_2m: 5, weather_code: 0, apparent_temperature: 3 }, daily: day }) as never;
  const r = await weatherForecast({ days: 1 }, fake);
  const text = r.content[0].text;
  assert.match(text, /sunrise 07:12, sunset 16:21, UV 2/);
});

test('a time is read from the forecast’s local time, and none gives an empty time', () => {
  assert.equal(hourMinute('2026-11-28T16:21'), '16:21');
  assert.equal(hourMinute(undefined), '');
});
