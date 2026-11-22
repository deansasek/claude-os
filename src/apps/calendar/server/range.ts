// The range the Calendar app asks for: two local days, YYYY-MM-DD, the second one not included. Pure, so Node tests load it.

const MAX_DAYS = 400;   // a year view and a little over; no wider read

/** [from, to) in ms at local midnight, or null when either day is not a date, or the range is empty or too wide. */
export function rangeBounds(from: string, to: string): { from: number; to: number } | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from), b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!a || !b) return null;
  const f = new Date(+a[1], +a[2] - 1, +a[3]).getTime(), t = new Date(+b[1], +b[2] - 1, +b[3]).getTime();
  if (!Number.isFinite(f) || !Number.isFinite(t) || t <= f) return null;
  if ((t - f) / 864e5 > MAX_DAYS) return null;
  return { from: f, to: t };
}
