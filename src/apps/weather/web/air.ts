// Plain words for the US air quality index (AQI), and the air line shown under the Weather figure.
// Pure functions: no DOM, no fetch. Tested in test/weather-air.test.ts.
import type { WxAir } from '../api.ts';

/** The AQI band in plain words. Non-finite input gives an empty label. */
export function aqiLabel(aqi: number): string {
  if (!Number.isFinite(aqi)) return '';
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for sensitive groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very unhealthy';
  return 'Hazardous';
}

/** The air line: "Air quality 42 · Good", or '' when the API sent no AQI. */
export function airLine(air: WxAir | null): string {
  if (!air || air.aqi == null) return '';
  return `Air quality ${Math.round(air.aqi)} · ${aqiLabel(air.aqi)}`;
}

/** The pollen line, only for the types the API returned. '' when there are none. */
export function pollenLine(air: WxAir | null): string {
  if (!air || air.pollen.length === 0) return '';
  return `Pollen: ${air.pollen.map(p => `${p.name} ${Math.round(p.value)}`).join(' · ')} grains/m³`;
}
