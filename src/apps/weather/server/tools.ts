// Claude's Weather tool, as one in-process MCP server (claudeos_weather) that turns.ts adds to each session.
// Read-only: the forecast for the place set in Settings > Apps > Weather (weather.ts, the same read the Weather app uses).
// Each call is an ordinary tool call, so it goes through canUseTool (the approval card on the tablet) first.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { weather } from './weather.ts';

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) });

/** The clock time in a forecast's local time string ("2026-11-27T16:21"): "16:21". Empty when there is none. */
export function hourMinute(iso: string | undefined): string {
  return iso ? iso.slice(11, 16) : '';
}

// The sky words the Weather app shows for each WMO code (its table in web/art.ts, in lower case), so Claude says the same
// as the screen: "mostly clear" for 1, "cloudy" for 3, "freezing drizzle" for 56.
const SKY: Record<number, string> = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'cloudy', 45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'light showers', 81: 'showers', 82: 'heavy showers',
  85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorms', 96: 'thunderstorms, hail', 99: 'thunderstorms, hail',
};

/** One short phrase for a WMO weather code (what Open-Meteo sends), as the Weather app says it. */
export function skyWords(code: number): string {
  return SKY[code] ?? 'cloudy';
}

const dayShort = new Intl.DateTimeFormat([], { weekday: 'short', day: 'numeric', month: 'short' });

/** The weather_forecast reply. read defaults to weather; a throw counts as an error status. */
export async function weatherForecast({ days }: { days?: number }, read: typeof weather = weather) {
  let r;
  try { r = await read(); } catch { r = { status: 'error' as const }; }
  if (r.status === 'no_location') return text('No place is set for the weather yet. The user can pick one in Settings > Apps > Weather.', true);
  if (r.status === 'not_found') return text(`There’s no place called “${r.city}”. The user can pick another in Settings > Apps > Weather.`, true);
  if (r.status !== 'ok') return text('The weather couldn’t be read just now. Try again in a little while.', true);
  const unit = r.units === 'fahrenheit' ? '°F' : '°C';
  const n = Math.min(days ?? 7, r.daily.time.length);
  const rows: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(`${r.daily.time[i]}T12:00:00`);
    rows.push(`${dayShort.format(d)}: high ${Math.round(r.daily.temperature_2m_max[i])}${unit}, low ${Math.round(r.daily.temperature_2m_min[i])}${unit}, `
      + `${skyWords(r.daily.weather_code[i])}, rain ${Math.round(r.daily.precipitation_probability_max[i])}%, wind up to ${Math.round(r.daily.wind_speed_10m_max[i])} ${r.wind_unit}`
      + `, sunrise ${hourMinute(r.daily.sunrise?.[i])}, sunset ${hourMinute(r.daily.sunset?.[i])}, UV ${Math.round(r.daily.uv_index_max?.[i] ?? 0)}`);
  }
  const now = `Now ${Math.round(r.current.temperature_2m)}${unit}, ${skyWords(r.current.weather_code)}, feels like ${Math.round(r.current.apparent_temperature)}${unit}.`;
  return text(`Weather for ${r.place ?? 'the set place'}. ${now}\n${rows.join('\n')}`);
}

export const weatherServer = createSdkMcpServer({
  name: 'claudeos_weather',
  version: '1.0.0',
  tools: [
    tool('weather_forecast',
      'Read the weather forecast for the place set in Settings > Apps > Weather on the ClaudeOS tablet: now, and the next days (highs, lows, '
        + 'chance of rain, wind, sunrise and sunset, UV index). Read-only. days: how many days, 1 to 7 (the default is 7).',
      { days: z.number().int().min(1).max(7).optional() },
      (args) => weatherForecast(args)),
  ],
});
