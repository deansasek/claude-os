// Number, time and wording helpers shared by every app.
import { store } from './dom.ts';

export const fmt = (n: number): string =>
  n >= 1e9 ? (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'B'
  : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M'
  : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K'
  : String(Math.round(n));

/** "claude-opus-5-5" → "Opus 5.5" */
export const prettyModel = (m: string): string =>
  m.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase());

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
