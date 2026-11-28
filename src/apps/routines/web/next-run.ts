// The next routine that runs by itself, with no DOM: the earliest time after now among the routines with a time set.
// A routine with no days runs every day. The times are the tablet's local time.
import type { Routine } from '../api.ts';

export interface NextRun { name: string; at: Date }

/** The first time after `now` (within the next week) that a routine with a time set will run, or null when none has one. */
export function nextRun(routines: readonly Pick<Routine, 'name' | 'at'>[], now: Date): NextRun | null {
  let best: NextRun | null = null;
  for (const r of routines) {
    if (!r.at) continue;
    for (let d = 0; d <= 7; d++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, r.at.h, r.at.m);
      const allowed = !r.at.days.length || r.at.days.includes(day.getDay());
      if (allowed && day.getTime() > now.getTime()) {
        if (!best || day.getTime() < best.at.getTime()) best = { name: r.name, at: day };
        break;
      }
    }
  }
  return best;
}

const clock = (d: Date): string => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** The row's words: the routine's name, with when it runs ("Today 8:00 pm", "Tomorrow 7:00 am", or a weekday). */
export function nextRunWords(next: NextRun | null, now: Date): { val: string; sub: string } {
  if (!next) return { val: 'None set', sub: '' };
  const days = Math.round((new Date(next.at.getFullYear(), next.at.getMonth(), next.at.getDate()).getTime()
    - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 864e5);
  const weekday = next.at.toLocaleDateString(undefined, { weekday: 'long' });
  // a week away is the same weekday as today: "Next Wednesday", not a bare "Wednesday" that reads as today
  const when = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days >= 7 ? `Next ${weekday}` : weekday;
  return { val: next.name, sub: `${when} ${clock(next.at)}` };
}
