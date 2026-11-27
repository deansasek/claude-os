// The saved Quiet hours (Settings → Notifications), read field by field. A stored value that is not the right shape
// gives the defaults for those fields, so a bad value cannot break the status line or the Do Not Disturb tile. Pure.

export interface QuietHours { on: boolean; days: number[]; from: string; to: string; pauseWake: boolean }

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0];
const TIME = /^\d{1,2}:\d{2}$/;

/** Is the time `d` inside the quiet window? An overnight window (from after to) gives the small hours to the evening before. */
export function inQuietWindow(q: QuietHours, d: Date): boolean {
  if (!q.on) return false;
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const a = toMin(q.from), b = toMin(q.to), m = d.getHours() * 60 + d.getMinutes(), day = d.getDay();
  if (a === b) return false;
  if (a < b) return q.days.includes(day) && m >= a && m < b;
  return (m >= a && q.days.includes(day)) || (m < b && q.days.includes((day + 6) % 7));
}

/** Parse the stored Quiet hours text. A value that is not an object gives the defaults. */
export function parseQuiet(raw: string | null): QuietHours {
  let v: unknown;
  try { v = JSON.parse(raw || '{}'); } catch { v = null; }
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const days = Array.isArray(o.days)
    ? [...new Set(o.days.filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6))]
    : [];
  return {
    on: o.on === true,
    days: days.length ? days : ALL_DAYS,
    from: typeof o.from === 'string' && TIME.test(o.from) ? o.from : '22:00',
    to: typeof o.to === 'string' && TIME.test(o.to) ? o.to : '07:00',
    pauseWake: o.pauseWake !== false,
  };
}
