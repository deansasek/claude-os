// The hourly column for "now" on a forecast (src/apps/weather/web/index.ts). The PC keeps the last forecast while the internet
// is down, so the hours since the fetch move the column on. Pure: no DOM and no imports, so the test can run it under node.

/** The forecast's own clock, when it was fetched, and the hourly times. "2026-11-27T15:45" is location-local, with no zone. */
export interface NowForecast { current: { time: string }; hourly: { time: string[] }; updated: string }

/** The index of the hour that is now. A fresh forecast gives the hour it was fetched in; an older one moves on by the hours since. */
export function nowIndex(w: NowForecast, now: number = Date.now()): number {
  const base = w.hourly.time.indexOf(`${w.current.time.slice(0, 13)}:00`);
  if (base < 0) return 0;
  const minutes = Number(w.current.time.slice(14, 16)) || 0;
  const fetched = Date.parse(w.updated);
  const since = Number.isFinite(fetched) ? Math.max(0, now - fetched) : 0;
  const hours = Math.floor((minutes * 60e3 + since) / 3600e3);
  return Math.min(base + hours, w.hourly.time.length - 1);
}
