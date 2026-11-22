// Safety for replying from a shared screen: an optional PIN that unlocks the Hub for a few
// minutes, a lockout after repeated wrong guesses, and a log of every action taken from the Hub.
//
// The PIN is the ClaudeOS PIN (Settings → Security), the same one that locks the tablet. Until one is set, the older
// .hub-pin (or the HUB_PIN environment variable, 4 to 8 digits) still applies. With no PIN set, anyone at the Hub can reply and approve.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HUB } from '../../../core/server/paths.ts';
import { checkPin, pinFingerprint, pinStatus } from '../../settings/server/pin.ts';

const PIN_FILE = path.join(HUB, '.hub-pin');
const LOG_FILE = path.join(HUB, 'logs', 'hub-actions.log');
const UNLOCK_MS = 10 * 60e3;          // an unlock lasts 10 minutes past the last action
const MAX_TRIES = 5, LOCKOUT_MS = 5 * 60e3;

// token -> when it expires, and the PIN it was made with (a token from a PIN that has since changed or been removed is refused)
const tokens = new Map<string, { exp: number; fp: string | null }>();
/** Drop the tokens that have run out, so the map cannot grow for the whole uptime. */
function pruneTokens(): void {
  const now = Date.now();
  for (const [t, v] of tokens) if (v.exp < now) tokens.delete(t);
}
let fails: number[] = [];
let lockedUntil = 0;

function readPin(): string | null {
  const env = process.env.HUB_PIN?.trim();
  if (env && /^\d{4,8}$/.test(env)) return env;
  try {
    const p = fs.readFileSync(PIN_FILE, 'utf8').replace(/^﻿/, '').trim();
    return /^\d{4,8}$/.test(p) ? p : null;
  } catch { return null; }
}
// One PIN: once a ClaudeOS PIN is set (Settings → Security), it guards replies too. Until then the older .hub-pin does.
export const pinIsSet = (): boolean => pinStatus().set || readPin() != null;

const digest = (s: string) => crypto.createHash('sha256').update(s).digest();

export function unlock(pin: unknown, from: string): { ok: boolean; token?: string; ttl?: number; error?: string; retryIn?: number } {
  pruneTokens();
  if (pinStatus().set) {
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
  // no ClaudeOS PIN yet: the older .hub-pin still guards replies (set a PIN in Settings to use the one PIN)
  const real = readPin();
  if (!real) return { ok: false, error: 'no_pin' };
  const now = Date.now();
  if (now < lockedUntil) return { ok: false, error: 'locked', retryIn: Math.ceil((lockedUntil - now) / 1000) };
  const good = typeof pin === 'string' && crypto.timingSafeEqual(digest(pin), digest(real));
  logAction(from, good ? 'unlock' : 'unlock-failed', {});
  if (!good) {
    fails = fails.filter(t => now - t < LOCKOUT_MS).concat(now);
    if (fails.length >= MAX_TRIES) { lockedUntil = now + LOCKOUT_MS; fails = []; return { ok: false, error: 'locked', retryIn: LOCKOUT_MS / 1000 }; }
    return { ok: false, error: 'wrong_pin' };
  }
  fails = [];
  const token = crypto.randomBytes(24).toString('base64url');
  tokens.set(token, { exp: now + UNLOCK_MS, fp: null });
  return { ok: true, token, ttl: UNLOCK_MS / 1000 };
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
