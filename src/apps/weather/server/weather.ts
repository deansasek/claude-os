// Weather from Open-Meteo (free, no account). The location lives in meter-config.json,
// which the Hub's city picker writes through POST /api/location.
import fs from 'node:fs';
import type { LocationUpdate, Place, Units, Weather, WeatherOk, WxAir } from '../api.ts';
import { CONFIG_FILE, readJson, writeJsonFile } from '../../../core/server/paths.ts';

interface Config { lat?: number; lon?: number; place?: string; city?: string; units?: Units }

const geoCache = new Map<string, any>();
let wxCache: { key: string; at: number; data: WeatherOk } | null = null;
let inflight: { key: string; promise: Promise<any> } | null = null;   // the forecast request now on its way

export const readConfig = (): Config => readJson<Config>(CONFIG_FILE) || {};

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { 'User-Agent': 'claude-usage-meter', Accept: 'application/json' }, signal: AbortSignal.timeout(20e3) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Pollen types the Air Quality API serves (Europe only; elsewhere the API sends no value and no pollen line shows).
const POLLEN: [string, string][] = [['grass_pollen', 'grass'], ['birch_pollen', 'birch'], ['alder_pollen', 'alder'],
  ['mugwort_pollen', 'mugwort'], ['olive_pollen', 'olive'], ['ragweed_pollen', 'ragweed']];

async function airNow(lat: number, lon: number): Promise<WxAir> {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), timezone: 'auto',
    current: ['us_aqi', ...POLLEN.map(([key]) => key)].join(','),
  });
  const c = (await getJson('https://air-quality-api.open-meteo.com/v1/air-quality?' + q)).current || {};
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const pollen = POLLEN.flatMap(([key, name]) => { const value = num(c[key]); return value == null ? [] : [{ name, value }]; });
  return { aqi: num(c.us_aqi), pollen };
}

async function geocode(name: string, count: number): Promise<any[]> {
  const q = new URLSearchParams({ name, count: String(count), language: 'en', format: 'json' });
  return (await getJson('https://geocoding-api.open-meteo.com/v1/search?' + q)).results || [];
}

export async function weather(override?: Config): Promise<Weather> {
  const cfg = override || readConfig();
  let { lat, lon, place } = cfg;
  if ((lat == null || lon == null) && cfg.city) {
    const city = cfg.city;
    if (!geoCache.has(city)) {
      const res = await geocode(city.split(',')[0].trim(), 10);
      const hint = city.toLowerCase();
      const pick = (city.includes(',') && res.find(r => ['admin1', 'country', 'country_code'].some(k => r[k] && hint.includes(String(r[k]).toLowerCase())))) || res[0] || null;
      geoCache.set(city, pick);
    }
    const g = geoCache.get(city);
    if (!g) return { status: 'not_found', city };
    lat = g.latitude; lon = g.longitude; place = place || g.name;
  }
  if (lat == null || lon == null) return { status: 'no_location' };

  const units: Units = cfg.units || 'fahrenheit';
  const key = `${(+lat).toFixed(3)},${(+lon).toFixed(3)},${units}`;
  if (wxCache && wxCache.key === key && Date.now() - wxCache.at < 600e3) return { ...wxCache.data, place: place ?? wxCache.data.place };

  const imperial = units === 'fahrenheit';
  // eight days: a full week from today, plus enough hours for a 24-hour strip late on day seven
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), timezone: 'auto', forecast_days: '8',
    temperature_unit: units, wind_speed_unit: imperial ? 'mph' : 'kmh', precipitation_unit: imperial ? 'inch' : 'mm',
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,is_day,precipitation',
    hourly: 'temperature_2m,apparent_temperature,weather_code,precipitation_probability,wind_speed_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,uv_index_max,sunrise,sunset',
  });
  let body: any;
  try {
    // screens that miss the cache together share one request for the same place and units
    let pending = inflight && inflight.key === key ? inflight.promise : null;
    if (!pending) {
      pending = getJson('https://api.open-meteo.com/v1/forecast?' + q).finally(() => {
        if (inflight?.promise === pending) inflight = null;
      });
      inflight = { key, promise: pending };
    }
    body = await pending;
  } catch (e) {
    // offline: keep serving the last forecast for this place for a few hours; the page sees its
    // old `updated` time and says so
    if (wxCache && wxCache.key === key && Date.now() - wxCache.at < 6 * 3600e3) return { ...wxCache.data, place: place ?? wxCache.data.place };
    throw e;
  }
  // air quality is a side request: if it fails, the air line stays out and the forecast still shows
  const air = await airNow(+lat, +lon).catch(() => null);
  const data: WeatherOk = {
    status: 'ok', place: place ?? null, units,
    wind_unit: imperial ? 'mph' : 'km/h', precip_unit: imperial ? 'in' : 'mm',
    current: body.current, hourly: body.hourly, daily: body.daily, air, updated: new Date().toISOString(),
  };
  wxCache = { key, at: Date.now(), data };
  return data;
}

export async function searchPlaces(q: string): Promise<Place[]> {
  q = q.trim().slice(0, 60);
  if (q.length < 2) return [];
  return (await geocode(q, 6))
    .filter(r => r.latitude != null)
    .map(r => ({ name: r.name, region: r.admin1 ?? null, country: r.country ?? null, lat: r.latitude, lon: r.longitude }));
}

/** Called by the Hub's city picker. Merges into meter-config.json. */
export async function saveLocation(body: LocationUpdate): Promise<Weather> {
  const cfg = readConfig();
  if (body.lat != null && body.lon != null) {
    const lat = Number(body.lat), lon = Number(body.lon);
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) throw new Error('bad coordinates');
    cfg.lat = Math.round(lat * 1e4) / 1e4; cfg.lon = Math.round(lon * 1e4) / 1e4;
    cfg.place = String(body.place || '').slice(0, 60);
    delete cfg.city;
  }
  if (body.units === 'fahrenheit' || body.units === 'celsius') cfg.units = body.units;
  writeJsonFile(CONFIG_FILE, cfg, { indent: 2 });
  wxCache = null;
  return weather();
}
