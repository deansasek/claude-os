// The Clock app's running timer, as the other screens read it: the control centre, the drawer's timer line, the lock
// screen's glance and the ambient screen. The Clock app (src/apps/clock/web/index.ts) keeps the state under
// CLOCK_TIMER_KEY and does all the writes. These helpers take the raw stored text and `now`, so they test in node.

export const CLOCK_TIMER_KEY = 'clock.timer';

/** Time left on the running timer in ms, or null when none runs (or the stored text is not readable). */
export function clockTimerLeftMs(raw: string | null, now: number): number | null {
  try {
    const t = JSON.parse(raw || 'null') as { end?: number | null } | null;
    const ms = t?.end ? t.end - now : 0;
    return ms > 0 ? ms : null;
  } catch { return null; }
}

/** "4:59", or "1:04:59" from an hour up: the running timer's countdown, or null when none runs. */
export function clockTimerText(raw: string | null, now: number): string | null {
  const ms = clockTimerLeftMs(raw, now);
  if (ms == null) return null;
  const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`;
}
