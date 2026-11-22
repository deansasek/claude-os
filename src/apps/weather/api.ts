// Shapes of what the Weather app's server routes send to its page. Imported by both sides.

// ---------- weather (Open-Meteo) ----------
export type Units = 'fahrenheit' | 'celsius';

export interface WxCurrent {
  time: string;                 // location-local, e.g. "2026-11-20T21:15"
  temperature_2m: number;
  apparent_temperature: number;
  weather_code: number;
  wind_speed_10m: number;
  relative_humidity_2m: number;
  is_day: number;
  precipitation: number;
}

export interface WxHourly {
  time: string[];
  temperature_2m: number[];
  apparent_temperature: number[];
  weather_code: number[];
  precipitation_probability: number[];
  wind_speed_10m: number[];
  is_day: number[];
}

export interface WxDaily {
  time: string[];               // "2026-11-20"
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_probability_max: number[];
  precipitation_sum: number[];
  wind_speed_10m_max: number[];
  uv_index_max: number[];
  sunrise: string[];
  sunset: string[];
}

export interface WeatherOk {
  status: 'ok';
  place: string | null;
  units: Units;
  wind_unit: string;
  precip_unit: string;
  current: WxCurrent;
  hourly: WxHourly;
  daily: WxDaily;
  updated: string;
}

export type Weather =
  | WeatherOk
  | { status: 'no_location' }
  | { status: 'not_found'; city: string }
  | { status: 'error'; error?: string }
  | { status: 'loading' };

export interface Place {
  name: string;
  region: string | null;
  country: string | null;
  lat: number;
  lon: number;
}

export interface PlacesResponse {
  status: 'ok' | 'error';
  results: Place[];
  error?: string;
}

export interface LocationUpdate {
  lat?: number;
  lon?: number;
  place?: string;
  units?: Units;
}
