// Pure helpers for the add-event day and time pickers (index.ts). No DOM, no store: test/calendar-pickers.test.ts runs them.
// Times are "HH:MM" on a 24-hour clock, the same text the draft keeps. Days are "YYYY-MM-DD".

const pad2 = (n: number): string => String(n).padStart(2, '0');
const MINUTES_IN_DAY = 24 * 60;

/** "09:30" → 570. Null when the text is not a clock time. */
export function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
}

/** Move a clock time by some minutes. It wraps at midnight, so 23:30 + 60 is 00:30. */
export function stepClock(hhmm: string, minutes: number): string {
  const t = minutesOf(hhmm) ?? 0;
  const total = ((t + minutes) % MINUTES_IN_DAY + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/**
 * The end time after the start moves. The event keeps its length: the end is the new start plus the old length.
 * A start that was not before its end (or an unreadable end) gets a 30-minute length.
 */
export function shiftEnd(oldStart: string, newStart: string, end: string): string {
  const s = minutesOf(oldStart), e = minutesOf(end);
  const length = s != null && e != null && e > s ? e - s : 30;
  // the end stops at 23:59 rather than wrapping past midnight (a 23:45 start with a 30-minute length is 23:59, not 00:15)
  const total = Math.min((minutesOf(newStart) ?? 0) + length, MINUTES_IN_DAY - 1);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/**
 * The weeks of one month for the day grid, Monday first. Each cell is a "YYYY-MM-DD" key, or null for a day
 * outside the month. `month` is 0 to 11, as in Date.
 */
export function monthWeeks(year: number, month: number): (string | null)[][] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${pad2(month + 1)}-${pad2(d)}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
