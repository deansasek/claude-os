// Claude's weather_forecast can list the next hours from the hourly forecast, starting at the hour that is now (src/apps/weather/server/tools.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { weatherForecast } from '../src/apps/weather/server/tools.ts';

const day = { time: ['2026-11-28'], temperature_2m_max: [10], temperature_2m_min: [4], weather_code: [3], precipitation_probability_max: [20], wind_speed_10m_max: [12], sunrise: ['2026-11-28T07:10'], sunset: ['2026-11-28T16:20'], uv_index_max: [1] };
// hourly from 06:00 on Saturday 28 November; the forecast was read at 09:30, so the hour that is now is 09:00
const hourTimes = Array.from({ length: 12 }, (_, i) => `2026-11-28T${String(6 + i).padStart(2, '0')}:00`);
const hourly = {
  time: hourTimes,
  temperature_2m: hourTimes.map((_, i) => 5 + i),
  apparent_temperature: hourTimes.map((_, i) => 3 + i),
  weather_code: hourTimes.map((_, i) => (i === 4 ? 63 : 3)),            // 10:00 is rain
  precipitation_probability: hourTimes.map((_, i) => (i === 4 ? 60 : 10)),
  wind_speed_10m: hourTimes.map((_, i) => 8 + i),
};
const current = { time: '2026-11-28T09:30', temperature_2m: 8, weather_code: 3, apparent_temperature: 6 };
const fresh = () => ({ status: 'ok', place: 'Testville', units: 'celsius', wind_unit: 'km/h', daily: day, current, hourly, updated: new Date().toISOString() }) as never;

test('the next hours come from the hour that is now, with time, temperature, sky, rain and wind', async () => {
  const r = await weatherForecast({ days: 1, hours: 3 }, async () => fresh());
  const text = r.content[0].text;
  assert.match(text, /Next hours:\n09:00: 8°C, cloudy, rain 10%, wind 11 km\/h\n10:00: 9°C, rain, rain 60%, wind 12 km\/h\n11:00: 10°C, cloudy, rain 10%, wind 13 km\/h$/);
});

test('no hours asked, or a forecast with no hourly data, gives no hours and no error', async () => {
  const none = await weatherForecast({ days: 1 }, async () => fresh());
  assert.doesNotMatch(none.content[0].text, /Next hours/);
  const noHourly = await weatherForecast({ days: 1, hours: 3 }, async () => ({ ...(fresh() as object), hourly: undefined }) as never);
  assert.equal(noHourly.isError, undefined);
  assert.doesNotMatch(noHourly.content[0].text, /Next hours/);
});
