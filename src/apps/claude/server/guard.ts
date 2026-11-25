// Safety for replying from a shared screen: an optional PIN that unlocks the Hub for a few
// minutes, a lockout after repeated wrong guesses, and a log of every action taken from the Hub.
//
// The PIN is the ClaudeOS PIN (Settings → Security), the same one that locks the tablet. With no PIN set, anyone at the Hub can reply and approve.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HUB } from '../../../core/server/paths.ts';
import { checkPin, pinFingerprint, pinStatus } from '../../settings/server/pin.ts';

const LOG_FILE = path.join(HUB, 'logs', 'hub-actions.log');
const UNLOCK_MS = 10 * 60e3;          // an unlock lasts 10 minutes past the last action

// token -> when it expires, and the PIN it was made with (a token from a PIN that has since changed or been removed is refused)
const tokens = new Map<string, { exp: number; fp: string | null }>();
/** Drop the tokens that have run out, so the map cannot grow for the whole uptime. */
function pruneTokens(): void {
  const now = Date.now();
  for (const [t, v] of tokens) if (v.exp < now) tokens.delete(t);
}

export const pinIsSet = (): boolean => pinStatus().set;

export function unlock(pin: unknown, from: string): { ok: boolean; token?: string; ttl?: number; error?: string; retryIn?: number } {
  pruneTokens();
  if (!pinStatus().set) return { ok: false, error: 'no_pin' };
  // the ClaudeOS PIN: its own tries and cooldown live in settings/server/pin.ts, so they are not counted twice here
  const r = checkPin(pin);
  logAction(from, r.ok ? 'unlock' : 'unlock-failed', {});
  if (r.ok) {
    const token = crypto.randomBytes(24).toString('base64url');
    tokens.set(token, { exp: Date.now() + UNLOCK_MS, fp: pinFingerprint() });
    return { ok: true, token, ttl: UNLOCK_MS / 1000 };
  }
  if (r.error === 'locked') return { ok: false, error: 'locked', retryIn: r.lockedFor };
  if (r.error === 'wrong') return { ok: false, error: 'wrong_pin' };
  return { ok: false, error: 'unlock_failed' };
}

/** True if the token is a live unlock; each use extends it. */
export function checkToken(token: unknown): boolean {
  if (!pinIsSet()) return true;   // no PIN set: nothing to unlock
  if (typeof token !== 'string') return false;
  const v = tokens.get(token);
  // a token made with a PIN that has since been changed or removed is no longer an unlock
  const fp = pinStatus().set ? pinFingerprint() : null;
  if (!v || v.exp < Date.now() || v.fp !== fp) { tokens.delete(token); return false; }
  tokens.set(token, { exp: Date.now() + UNLOCK_MS, fp: v.fp });
  return true;
}

/** The action log is kept to one backup: past LOG_MAX_BYTES it moves to <file>.1 and a new log starts. */
const LOG_MAX_BYTES = 5 * 1024 * 1024;

export function logAction(from: string, action: string, details: Record<string, unknown>): void {
  const line = JSON.stringify({ at: new Date().toISOString(), from, action, ...details });
  console.log(`claude: ${action} from ${from}${details.session ? ` (session ${String(details.session).slice(0, 8)})` : ''}`);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    try {
      if (fs.statSync(LOG_FILE).size > LOG_MAX_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    } catch { /* no log yet */ }
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) { console.log('could not write action log:', e); }
}
