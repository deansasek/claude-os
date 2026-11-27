// Number, time and wording helpers shared by every app.
import { store } from './dom.ts';

/** The units, largest first. `whole`: from this many of the unit, no decimal place (9.5M is shown, 120M is not). */
const SCALES = [{ div: 1e9, suffix: 'B', whole: 10 }, { div: 1e6, suffix: 'M', whole: 100 }, { div: 1e3, suffix: 'K', whole: 100 }] as const;

export const fmt = (n: number): string => {
  for (let i = 0; i < SCALES.length; i++) {
    const { div, suffix, whole } = SCALES[i];
    if (n < div) continue;
    const text = (n / div).toFixed(n / div >= whole ? 0 : 1);
    // rounding can reach the next unit (999.96K would read 1000K): show that unit instead, as 1.0M
    if (i > 0 && Number(text) >= 1000) return fmt(SCALES[i - 1].div);
    return text + suffix;
  }
  // 999.5 to 999.99 is below 1000 but rounds to it: show the next unit, as 1.0K
  const r = Math.round(n);
  return r >= 1000 ? fmt(1000) : String(r);
};

/** "claude-opus-5-5" → "Opus 5.5" */
export const prettyModel = (m: string): string =>
  m.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase());

/** A time of day. Settings → Date & time can choose 24-hour; unset, it follows the tablet's own locale. */
export const clock = (d: Date): string => {
  const h24 = store.get('os.clock24');
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...(h24 == null ? {} : { hour12: h24 !== '1' }) });
};

export function untilText(ms: number): string {
  if (ms <= 0) return 'now';
  const m = Math.floor(ms / 6e4), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${m}m`;
}

export function whenText(date: Date): string {
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return clock(date);
  const tmr = new Date(now); tmr.setDate(now.getDate() + 1);
  if (date.toDateString() === tmr.toDateString()) return `Tomorrow ${clock(date)}`;
  return `${date.toLocaleDateString([], { weekday: 'short' })} ${clock(date)}`;
}

export const shortAge = (s: number): string => s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;

/** Location-local "2026-11-20T21:00" → "9 PM" / "9:15 PM" (no time-zone conversion). */
export function localHour(s: string, withMinutes = false): string {
  const h = +s.slice(11, 13), m = s.slice(14, 16);
  return `${h % 12 || 12}${withMinutes ? ':' + m : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "2026-11-22" → Date at local midnight (for weekday names). */
export function localDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
