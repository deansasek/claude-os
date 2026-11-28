// Claude's weather_forecast gives the air quality, the pollen and the daily rain amount, as the Weather app does (src/apps/weather/server/tools.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { weatherForecast } from '../src/apps/weather/server/tools.ts';

const day = { time: ['2026-11-28'], temperature_2m_max: [10], temperature_2m_min: [4], weather_code: [3], precipitation_probability_max: [20], precipitation_sum: [3.25], wind_speed_10m_max: [12], sunrise: ['2026-11-28T07:10'], sunset: ['2026-11-28T16:20'], uv_index_max: [1] };
const current = { time: '2026-11-28T09:00', temperature_2m: 8, weather_code: 3, apparent_temperature: 6 };
const base = { status: 'ok', place: 'Testville', units: 'celsius', wind_unit: 'km/h', precip_unit: 'mm', daily: day, current, updated: new Date().toISOString() };

test('the reply gives the air quality and the pollen, and the rain amount for the day', async () => {
  const r = await weatherForecast({ days: 1 }, async () => ({ ...base, air: { aqi: 42, pollen: [{ name: 'Birch', value: 12.4 }] } }) as never);
  const text = r.content[0].text;
  assert.match(text, /Air quality 42 · /);
  assert.match(text, /Pollen: Birch 12 grains\/m³\./);
  assert.match(text, /rain 20% \(3\.3 mm\)/);
});

test('with no air data, the reply leaves the air and pollen out, and still gives the forecast', async () => {
  const r = await weatherForecast({ days: 1 }, async () => ({ ...base, air: null }) as never);
  assert.equal(r.isError, undefined);
  assert.doesNotMatch(r.content[0].text, /Air quality|Pollen/);
  assert.match(r.content[0].text, /Weather for Testville\. Now 8°C/);
});
