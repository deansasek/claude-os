// The tablet's own copy of the ClaudeOS PIN check, for when the PC can't be reached (lock.ts). It keeps only the
// salted PBKDF2 hash that the PC gives (GET /api/settings/pin/record) and the wrong-try count, never the PIN. The same
// rule as the PC (settings/server/pin.ts): five wrong tries in a row start a 30-second cooldown.
// The copy is refreshed each time the PC says a PIN is set (lock.ts, settings/web/pin.ts) and removed when it is gone.
// No DOM imports here: test/pin-local.test.ts runs this file in node.
import { hexToBytes, pbkdf2Hex } from './pbkdf2.ts';

export interface PinRecord { salt: string; hash: string; iterations: number }
export interface LocalState { fails: number; lockedUntil: number }
export interface LocalResult { ok: boolean; error?: 'locked' | 'wrong'; left?: number; lockedFor: number }

const MAX_TRIES = 5, COOLDOWN_MS = 30 * 1000;
const RECORD_KEY = 'os.pinRecord', STATE_KEY = 'os.pinTries';
const FRESH: LocalState = { fails: 0, lockedUntil: 0 };

/** Does `pin` match the stored hash. Slow on purpose (200 000 rounds): run it after a paint. */
export function matchesRecord(rec: PinRecord, pin: string): boolean {
  return pbkdf2Hex(pin, rec.salt, rec.iterations) === rec.hash;
}

/**
 * Count one guess. `matched` is whether the PIN was right. Pure: returns the new state and what the lock shows.
 * Nothing counts while a cooldown runs (`matched` is then ignored).
 */
export function applyGuess(st: LocalState, matched: boolean, now: number): { state: LocalState; result: LocalResult } {
  if (st.lockedUntil > now) {
    return { state: st, result: { ok: false, error: 'locked', lockedFor: Math.ceil((st.lockedUntil - now) / 1000) } };
  }
  if (matched) return { state: { ...FRESH }, result: { ok: true, lockedFor: 0 } };
  const fails = st.fails + 1;
  if (fails >= MAX_TRIES) {
    return { state: { fails: 0, lockedUntil: now + COOLDOWN_MS }, result: { ok: false, error: 'locked', lockedFor: COOLDOWN_MS / 1000 } };
  }
  return { state: { fails, lockedUntil: 0 }, result: { ok: false, error: 'wrong', left: MAX_TRIES - fails, lockedFor: 0 } };
}

// ---------- storage (the browser's local storage; a failed read or write means no copy, never a crash) ----------
function readJson(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: the copy is not kept */ }
}
function removeKey(key: string): void {
  try { localStorage.removeItem(key); } catch { /* nothing to remove */ }
}

/** The stored record, or null when the tablet has no copy. */
export function localRecord(): PinRecord | null {
  const r = readJson(RECORD_KEY) as Partial<PinRecord> | null;
  if (!r || typeof r.salt !== 'string' || typeof r.hash !== 'string' || typeof r.iterations !== 'number') return null;
  try { hexToBytes(r.salt); } catch { return null; }
  return { salt: r.salt, hash: r.hash, iterations: r.iterations };
}

function readState(): LocalState {
  const s = readJson(STATE_KEY) as Partial<LocalState> | null;
  if (!s) return { ...FRESH };
  return {
    fails: typeof s.fails === 'number' && s.fails > 0 ? Math.floor(s.fails) : 0,
    lockedUntil: typeof s.lockedUntil === 'number' ? s.lockedUntil : 0,
  };
}

/** Keep the PC's record. A new record (the PIN was set or changed) clears the wrong-try count. */
export function saveLocalRecord(rec: PinRecord): void {
  const old = localRecord();
  if (old && old.salt === rec.salt && old.hash === rec.hash && old.iterations === rec.iterations) return;
  writeJson(RECORD_KEY, rec);
  removeKey(STATE_KEY);
}

/** Forget the copy (the PIN was removed on the PC). */
export function clearLocalRecord(): void {
  removeKey(RECORD_KEY);
  removeKey(STATE_KEY);
}

export const hasLocalPin = (): boolean => localRecord() !== null;

/** Seconds of cooldown left on this tablet (0 when none). */
export function localLockedFor(now = Date.now()): number {
  const st = readState();
  return st.lockedUntil > now ? Math.ceil((st.lockedUntil - now) / 1000) : 0;
}

/** Check a PIN on this tablet. Null when the tablet has no copy. Counts the try and saves the count. */
export async function checkLocally(pin: string): Promise<LocalResult | null> {
  const rec = localRecord();
  if (!rec) return null;
  const st = readState();
  if (st.lockedUntil > Date.now()) return applyGuess(st, false, Date.now()).result;
  await new Promise(resolve => setTimeout(resolve, 30));   // let the page show "checking" before the slow hash
  const { state, result } = applyGuess(st, matchesRecord(rec, pin), Date.now());
  writeJson(STATE_KEY, state);
  return result;
}

/** Fetch the PC's record and keep it. The PC being unreachable keeps the copy as it is. */
export async function syncLocalPin(): Promise<void> {
  try {
    const r = await fetch('/api/settings/pin/record', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!r.ok) return;
    const j = await r.json() as { set?: boolean } & Partial<PinRecord>;
    if (j.set === false) { clearLocalRecord(); return; }
    if (typeof j.salt === 'string' && typeof j.hash === 'string' && typeof j.iterations === 'number') {
      saveLocalRecord({ salt: j.salt, hash: j.hash, iterations: j.iterations });
    }
  } catch { /* the PC can't be reached: keep the copy */ }
}
