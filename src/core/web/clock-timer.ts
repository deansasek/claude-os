// The Clock app's timers, as the other screens read them: the control centre, the drawer's timer line, the lock
// screen's glance, the ambient screen, Home and the voice commands. The Clock app (src/apps/clock/web/index.ts) keeps
// the list under CLOCK_TIMERS_KEY and does all the writes. A single timer saved by an earlier build (CLOCK_TIMER_KEY) is
// read as the first timer here; the Clock app saves the list and removes the old key the first time it reads.
// The helpers take raw stored text or a list, and `now`, so they test in node (test/clock-timer.test.ts).

export const CLOCK_TIMERS_KEY = 'clock.timers';
export const CLOCK_TIMER_KEY = 'clock.timer';   // the one-timer key of earlier builds

/** One timer. end: ms epoch while it runs, else null. left: ms left while paused, else null. dur: the set length in ms. */
export interface ClockTimer { id: string; name: string; dur: number; end: number | null; left: number | null }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One stored timer, checked. Null when it has no usable length. */
function checked(v: unknown, i: number): ClockTimer | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!isNum(o.dur) || o.dur < 1e3) return null;
  return {
    id: typeof o.id === 'string' && o.id ? o.id : `t${i}`,
    name: typeof o.name === 'string' && o.name ? o.name : `Timer ${i + 1}`,
    dur: o.dur,
    end: isNum(o.end) ? o.end : null,
    left: isNum(o.left) ? o.left : null,
  };
}

const parseJson = (raw: string | null): unknown => { try { return JSON.parse(raw || 'null'); } catch { return null; } };

/**
 * The list from the stored text. When there is no list but an earlier single timer is stored, the caller saves the
 * list and removes the old key (`migrate`). A running or paused earlier timer becomes the first entry. An idle one has
 * no entry: its length comes back as `draft` for the Clock's dial, and the old key is still removed.
 */
export function parseClockTimers(list: string | null, legacy: string | null): { timers: ClockTimer[]; migrate: boolean; draft: number | null } {
  const arr = parseJson(list);
  if (Array.isArray(arr)) {
    return { timers: arr.map((v, i) => checked(v, i)).filter((t): t is ClockTimer => t !== null), migrate: false, draft: null };
  }
  const old = parseJson(legacy);
  if (!old || typeof old !== 'object') return { timers: [], migrate: false, draft: null };
  const o = old as Record<string, unknown>;
  const t = checked({ ...o, id: 'timer', name: typeof o.label === 'string' && o.label ? o.label : undefined }, 0);
  if (t && (t.end != null || t.left != null)) return { timers: [t], migrate: true, draft: null };
  const draft = isNum(o.dur) && o.dur >= 1e3 ? o.dur : null;
  return { timers: [], migrate: draft != null, draft };
}

/** The timers as stored now, read only (nothing is saved). */
export function readClockTimers(get: (key: string) => string | null): ClockTimer[] {
  return parseClockTimers(get(CLOCK_TIMERS_KEY), get(CLOCK_TIMER_KEY)).timers;
}

/** The default name for a new timer: the lowest "Timer N" that no listed timer has, so a name is not repeated after a cancel. */
export function nextTimerName(timers: ClockTimer[]): string {
  const used = new Set(timers.map(t => t.name));
  let n = 1;
  while (used.has(`Timer ${n}`)) n++;
  return `Timer ${n}`;
}

/** Time left on the soonest running timer in ms, or null when none runs. */
export function runningLeftMs(timers: ClockTimer[], now: number): number | null {
  let best: number | null = null;
  for (const t of timers) {
    if (!t.end) continue;
    const ms = t.end - now;
    if (ms > 0 && (best == null || ms < best)) best = ms;
  }
  return best;
}

/** "4:59", or "1:04:59" from an hour up: the countdown of the soonest running timer, or null when none runs. */
export function clockTimerText(timers: ClockTimer[], now: number): string | null {
  const ms = runningLeftMs(timers, now);
  if (ms == null) return null;
  const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`;
}
