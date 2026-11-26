// The saved stopwatch: running, start, acc and laps. Read from the store and checked field by field, so a stored value
// that is not the right shape loads as a stopped stopwatch and cannot break the Clock app. Pure: no DOM, no store.

export interface SwState { running: boolean; start: number; acc: number; laps: number[] }   // laps: split times (ms since start)

const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** Parse the stored stopwatch text. Anything that is not an object gives the stopped defaults. */
export function parseStopwatch(raw: string | null): SwState {
  let v: unknown;
  try { v = JSON.parse(raw || 'null'); } catch { v = null; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { running: false, start: 0, acc: 0, laps: [] };
  const o = v as Record<string, unknown>;
  const start = finite(o.start);
  const running = o.running === true && start > 0;   // a running stopwatch with no valid start loads as stopped
  const laps = Array.isArray(o.laps) ? o.laps.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0) : [];
  return { running, start: running ? start : 0, acc: finite(o.acc), laps };
}
