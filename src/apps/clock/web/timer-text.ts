// Timer text, shared by the Clock app (its timer and alarms) and the Recipes app (cook-mode timers).
// Pure functions: no DOM, no store.

const pad = (n: number) => String(n).padStart(2, '0');

/** 65000 → "1:05", 3723000 → "1:02:03" */
export function dur(ms: number, ceil = true): string {
  const s = Math.max(0, ceil ? Math.ceil(ms / 1e3) : Math.floor(ms / 1e3));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** "8h 12m", "12m", "40s" */
export function words(ms: number): string {
  const m = Math.round(ms / 60e3);
  // seconds only while they round to under a minute: 59.7 s is "1m", not "60s"
  const sec = Math.round(ms / 1e3);
  if (sec < 60) return `${Math.max(1, sec)}s`;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m}m`;
}

/** "5 min", "1 hr 30 min", "45 sec" — for describing a timer's length */
export function lengthWords(ms: number): string {
  const s = Math.round(ms / 1e3), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  const out = [h && `${h} hr`, m && `${m} min`, sec && `${sec} sec`].filter(Boolean);
  return out.join(' ') || '0 sec';
}

/** "Mon" or "Monday" for a Date.getDay() value (2 Jan 2000 was a Sunday) */
export const dayName = (day: number, style: 'short' | 'long' = 'short') =>
  new Date(2000, 0, 2 + day).toLocaleDateString([], { weekday: style });

/** Calendar days from today to the day of t: 0 is today, 1 is tomorrow */
export function daysAhead(t: number, d: Date = new Date()): number {
  const today = new Date(d); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(t).setHours(0, 0, 0, 0) - today.getTime()) / 864e5);
}

/** "today", "tomorrow", "Thursday", or "next Thursday" for 7 or more days: when an alarm next rings */
export function whenWord(t: number, d: Date = new Date()): string {
  const days = daysAhead(t, d);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  const day = dayName(new Date(t).getDay(), 'long');
  return days >= 7 ? `next ${day}` : day;
}
