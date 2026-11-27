// Which alarm occurrence is due now (index.ts checkAlarms). Pure: no DOM, so Node can run it. An occurrence counts as due
// up to a grace period after its time. Today's and yesterday's are checked, so an alarm set for just before midnight
// still rings when the check runs just after midnight.

/** The key that marks an occurrence as fired: the alarm's time on that date. */
export const occurrenceKey = (a: { h: number; m: number }, t: Date): string => `${t.toDateString()} ${a.h}:${a.m}`;

/** The occurrence that is due at `d`: on an allowed day, from its time up to graceMs late, and not already fired. Else null. */
export function dueOccurrence(a: { h: number; m: number; days: number[]; fired: string | null }, d: Date, graceMs: number): Date | null {
  for (const back of [0, 1]) {
    const t = new Date(d);
    t.setDate(t.getDate() - back);
    t.setHours(a.h, a.m, 0, 0);
    const late = d.getTime() - t.getTime();
    if (late < 0 || late > graceMs) continue;
    if (a.days.length && !a.days.includes(t.getDay())) continue;
    if (a.fired === occurrenceKey(a, t)) continue;
    return t;
  }
  return null;
}
