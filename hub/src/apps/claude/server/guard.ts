// Safety for replying from a shared screen: an optional PIN that unlocks the Hub for a few
// minutes, a lockout after repeated wrong guesses, and a log of every action taken from the Hub.
//
// The PIN is optional and set on the PC, never from the Hub: put 4–8 digits in hub/.hub-pin
// (or the HUB_PIN environment variable). With no PIN set, anyone at the Hub can reply and approve.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HUB } from '../../../core/server/paths.ts';

const PIN_FILE = path.join(HUB, '.hub-pin');
const LOG_FILE = path.join(HUB, 'logs', 'hub-actions.log');
const UNLOCK_MS = 10 * 60e3;          // an unlock lasts 10 minutes past the last action
const MAX_TRIES = 5, LOCKOUT_MS = 5 * 60e3;

const tokens = new Map<string, number>();       // token -> expires at
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
export const pinIsSet = (): boolean => readPin() != null;

const digest = (s: string) => crypto.createHash('sha256').update(s).digest();

export function unlock(pin: unknown, from: string): { ok: boolean; token?: string; ttl?: number; error?: string; retryIn?: number } {
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
  tokens.set(token, now + UNLOCK_MS);
  return { ok: true, token, ttl: UNLOCK_MS / 1000 };
}

/** True if the token is a live unlock; each use extends it. */
export function checkToken(token: unknown): boolean {
  if (!pinIsSet()) return true;   // no PIN set: nothing to unlock
  if (typeof token !== 'string') return false;
  const exp = tokens.get(token);
  if (!exp || exp < Date.now()) { tokens.delete(token); return false; }
  tokens.set(token, Date.now() + UNLOCK_MS);
  return true;
}

export function logAction(from: string, action: string, details: Record<string, unknown>): void {
  const line = JSON.stringify({ at: new Date().toISOString(), from, action, ...details });
  console.log(`claude: ${action} from ${from}${details.session ? ` (session ${String(details.session).slice(0, 8)})` : ''}`);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) { console.log('could not write action log:', e); }
}
