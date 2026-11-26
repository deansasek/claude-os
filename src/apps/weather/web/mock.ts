// Weather in the mock page (no hub): a sample forecast for a made-up town, so the app shows a full screen.
// The shapes are the ones in ../api.ts. The numbers are fixed, not real.
import { defineMock } from '../../../core/web/mock-api.ts';
import type { PlacesResponse, Weather, WeatherOk } from '../api.ts';

const DAY = '2026-11-25';
const hours = Array.from({ length: 24 }, (_, h) => `${DAY}T${String(h).padStart(2, '0')}:00`);
const days = Array.from({ length: 7 }, (_, i) => `2026-11-${String(25 + i).padStart(2, '0')}`);

const forecast: WeatherOk = {
  status: 'ok',
  place: 'Sample town',
  units: 'celsius',
  wind_unit: 'km/h',
  precip_unit: 'mm',
  current: {
    time: `${DAY}T12:00`, temperature_2m: 9.5, apparent_temperature: 7.8, weather_code: 3, wind_speed_10m: 14,
    relative_humidity_2m: 71, is_day: 1, precipitation: 0,
  },
  hourly: {
    time: hours,
    temperature_2m: hours.map((_, h) => 6 + Math.round(4 * Math.sin((h - 8) / 24 * Math.PI * 2))),
    apparent_temperature: hours.map((_, h) => 4 + Math.round(4 * Math.sin((h - 8) / 24 * Math.PI * 2))),
    weather_code: hours.map((_, h) => (h % 6 === 3 ? 61 : 3)),
    precipitation_probability: hours.map((_, h) => (h % 6 === 3 ? 60 : 10)),
    wind_speed_10m: hours.map(() => 12),
    is_day: hours.map((_, h) => (h >= 7 && h < 17 ? 1 : 0)),
  },
  daily: {
    time: days,
    weather_code: days.map((_, i) => (i % 3 === 1 ? 61 : 2)),
    temperature_2m_max: days.map((_, i) => 10 + i % 4),
    temperature_2m_min: days.map((_, i) => 3 + i % 3),
    precipitation_probability_max: days.map((_, i) => (i % 3 === 1 ? 70 : 20)),
    precipitation_sum: days.map((_, i) => (i % 3 === 1 ? 4.2 : 0)),
    wind_speed_10m_max: days.map(() => 22),
    uv_index_max: days.map(() => 1.5),
    sunrise: days.map(d => `${d}T07:42`),
    sunset: days.map(d => `${d}T16:21`),
  },
  air: { aqi: 28, pollen: [{ name: 'grass', value: 4 }] },
  updated: `${DAY}T12:00`,
};

const places: PlacesResponse = {
  status: 'ok',
  results: [{ name: 'Sample town', region: 'Demo county', country: 'Nowhere', lat: 51.5, lon: -0.12 }],
};

defineMock({
  'GET /api/weather/forecast': (): Weather => forecast,
  'GET /api/weather/places': (): PlacesResponse => places,
  'POST /api/weather/location': (): Weather => forecast,   // a saved place: the same sample forecast
});
