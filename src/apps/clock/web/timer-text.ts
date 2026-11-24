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
  if (ms < 60e3) return `${Math.max(1, Math.round(ms / 1e3))}s`;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m}m`;
}

/** "5 min", "1 hr 30 min", "45 sec" — for describing a timer's length */
export function lengthWords(ms: number): string {
  const s = Math.round(ms / 1e3), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  const out = [h && `${h} hr`, m && `${m} min`, sec && `${sec} sec`].filter(Boolean);
  return out.join(' ') || '0 sec';
}
