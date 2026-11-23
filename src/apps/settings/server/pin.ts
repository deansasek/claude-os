// The ClaudeOS PIN: an optional 4 to 6 digit lock for the tablet, set in Settings → Security. Kept on this PC in
// claudeos-pin.json as a salted PBKDF2 hash (never the PIN itself). The file is read on every request, so
// deleting it clears the PIN at once, with no restart. The wrong-try count and the cooldown live in the file too,
// so a restart can't reset them. This one PIN also guards replies in the Claude app (see claude/server/guard.ts); the older .hub-pin only applies until it is set.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HUB, readJson, writeJsonFile } from '../../../core/server/paths.ts';
import type { PinResult, PinStatus } from '../api.ts';

const FILE = process.env.CLAUDEOS_PIN_FILE || path.join(HUB, 'claudeos-pin.json');   // a test sets CLAUDEOS_PIN_FILE (test/pin.test.ts)
const ITERATIONS = 200000, KEY_BYTES = 32;
const MAX_TRIES = 5, COOLDOWN_MS = 30 * 1000;
const PIN_RE = /^\d{4,6}$/;

interface Stored {
  salt: string;          // hex
  hash: string;          // hex, PBKDF2-SHA256 of the PIN with the salt
  fails: number;         // wrong tries since the last success or cooldown
  lockedUntil: number;   // ms epoch; 0 when not in a cooldown
}

function load(): Stored | null {
  const s = readJson<Partial<Stored>>(FILE);
  if (!s || typeof s.salt !== 'string' || typeof s.hash !== 'string') return null;
  return {
    salt: s.salt,
    hash: s.hash,
    fails: typeof s.fails === 'number' && s.fails > 0 ? Math.floor(s.fails) : 0,
    lockedUntil: typeof s.lockedUntil === 'number' ? s.lockedUntil : 0,
  };
}

function save(s: Stored): boolean {
  try {
    writeJsonFile(FILE, s, { indent: 2 });
    return true;
  } catch (e) {
    console.log('settings: could not save the ClaudeOS PIN file:', e);
    return false;
  }
}

const derive = (pin: string, saltHex: string): Buffer =>
  crypto.pbkdf2Sync(pin, Buffer.from(saltHex, 'hex'), ITERATIONS, KEY_BYTES, 'sha256');

function matches(pin: unknown, s: Stored): boolean {
  if (typeof pin !== 'string') return false;
  const want = Buffer.from(s.hash, 'hex');
  const got = derive(pin, s.salt);
  return want.length === got.length && crypto.timingSafeEqual(got, want);
}

const secondsLeft = (until: number, now = Date.now()): number => Math.max(0, Math.ceil((until - now) / 1000));
const locked = (ms: number): PinResult => ({ ok: false, error: 'locked', lockedFor: Math.ceil(ms / 1000) });

/**
 * Check a guess against the stored PIN. A wrong one (or anything that isn't the PIN) counts as a failed try; the
 * fifth in a row starts a 30-second cooldown. Nothing is checked while in a cooldown.
 */
function guess(s: Stored, pin: unknown): PinResult {
  const now = Date.now();
  if (s.lockedUntil > now) return locked(s.lockedUntil - now);
  if (matches(pin, s)) {
    if (s.fails || s.lockedUntil) {
      s.fails = 0; s.lockedUntil = 0;
      if (!save(s)) return { ok: false, error: 'save_failed', lockedFor: 0 };
    }
    return { ok: true, set: true, lockedFor: 0 };
  }
  s.fails += 1;
  if (s.fails >= MAX_TRIES) {
    s.fails = 0; s.lockedUntil = now + COOLDOWN_MS;
    save(s);
    return locked(COOLDOWN_MS);
  }
  if (!save(s)) return { ok: false, error: 'save_failed', lockedFor: 0 };
  return { ok: false, error: 'wrong', left: MAX_TRIES - s.fails, lockedFor: 0 };
}

/** Is a PIN set, and how many seconds of cooldown are left. */
export function pinStatus(): PinStatus {
  const s = load();
  return s ? { set: true, lockedFor: secondsLeft(s.lockedUntil) } : { set: false, lockedFor: 0 };
}

/** A short fingerprint of the PIN as it is stored now: it changes when the PIN is set, changed or removed. Null if none. */
export function pinFingerprint(): string | null {
  const s = load();
  return s ? crypto.createHash('sha256').update(s.salt).update(s.hash).digest('hex').slice(0, 16) : null;
}

/** Try the PIN (the tablet's lock). */
export function checkPin(pin: unknown): PinResult {
  const s = load();
  if (!s) return { ok: false, error: 'no_pin', lockedFor: 0 };
  return guess(s, pin);
}

/** Set the PIN, or change it: when one is set, `current` must be right (a wrong one counts as a failed try). */
export function setPin(pin: unknown, current: unknown): PinResult {
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) return { ok: false, error: 'bad_pin', lockedFor: 0 };
  const old = load();
  if (old) {
    const r = guess(old, current);
    if (!r.ok) return r;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  if (!save({ salt, hash: derive(pin, salt).toString('hex'), fails: 0, lockedUntil: 0 })) return { ok: false, error: 'save_failed', lockedFor: 0 };
  console.log('settings: ClaudeOS PIN set');
  return { ok: true, set: true, lockedFor: 0 };
}

/** Remove the PIN. The current one must be right. */
export function removePin(pin: unknown): PinResult {
  const s = load();
  if (!s) return { ok: false, error: 'no_pin', lockedFor: 0 };
  const r = guess(s, pin);
  if (!r.ok) return r;
  try { fs.rmSync(FILE, { force: true }); } catch { return { ok: false, error: 'save_failed', lockedFor: 0 }; }
  console.log('settings: ClaudeOS PIN removed');
  return { ok: true, set: false, lockedFor: 0 };
}
