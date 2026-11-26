// ClaudeOS's own clip history: the last few things copied inside ClaudeOS (a Claude reply or code block, the Browser
// copy action). It lives in memory only, is never written to the PC or the tablet's storage, and each clip is gone
// after CLIP_TTL_MS. Anything that looks like a token, key or password is never kept. The keyboard (keyboard.ts) shows
// the clips as chips; a tap puts one in the field.
//
// The pruning and the token check are pure (no DOM, no storage), so the test runs under node.

export interface Clip { text: string; at: number }

export const CLIP_MAX = 5;
export const CLIP_TTL_MS = 10 * 60e3;
const CLIP_CHARS = 4000;          // longer copies are not kept (a whole document is not a clip)

/**
 * The clips still worth keeping at `now`: newest first, no older than the time limit, at most `max` of them.
 * The input is newest first, as the history keeps it.
 */
export function pruneClips(list: readonly Clip[], now: number, max = CLIP_MAX, ttl = CLIP_TTL_MS): Clip[] {
  return list.filter(c => now - c.at < ttl).slice(0, max);
}

/**
 * Milliseconds until the oldest clip runs out (plus a little, so it is gone when the timer fires), or null when there are
 * no clips. The chips repaint then, so a clip leaves the keyboard on time, not when the newest copy's timer runs out.
 */
export function nextExpiry(list: readonly Clip[], now: number, ttl = CLIP_TTL_MS): number | null {
  if (!list.length) return null;
  const oldest = Math.min(...list.map(c => c.at));
  return Math.max(0, oldest + ttl + 50 - now);
}

/**
 * True when the text looks like a secret: an API key or token prefix, a Bearer header, a JWT, or one long word with
 * both letters and digits. A web address is not a secret, even when it is long.
 */
export function isTokenLike(text: string): boolean {
  const t = text.trim();
  if (/\b(?:sk|pk|rk|ghp|gho|ghu|ghs|ghr|github_pat|xox[abprs]|AKIA|AIza|ya29)[-_][A-Za-z0-9_-]{8,}/.test(t)) return true;
  if (/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\./.test(t)) return true;
  if (/\bbearer\s+[A-Za-z0-9._~+/=-]{12,}/i.test(t)) return true;
  return t.split(/\s+/).some(w => w.length >= 24 && !w.includes('://') && /[A-Za-z]/.test(w) && /\d/.test(w));
}

let history: Clip[] = [];
const listeners: (() => void)[] = [];
let ticking = 0;

/** The clips now (pruned as they are read, so a clip is gone on time even when nothing else happens). */
export function clips(): readonly Clip[] {
  const kept = pruneClips(history, Date.now());
  if (kept.length !== history.length) { history = kept; emit(); scheduleRepaint(); }
  return history;
}

/** Repaint when the oldest clip runs out: one timer, set for that clip only. */
function scheduleRepaint(now = Date.now()): void {
  clearTimeout(ticking);
  const wait = nextExpiry(history, now);
  if (wait !== null) ticking = window.setTimeout(() => { clips(); }, wait);
}

function emit(): void { listeners.forEach(f => { try { f(); } catch { /* ignore */ } }); }

/** Something changed (a copy, or a clip ran out): the keyboard and anything else that shows clips repaints. */
export function onClipsChange(fn: () => void): void { listeners.push(fn); }

/** Keep a copy made in ClaudeOS. Returns false when it was not kept (empty, too long, or token-like). */
export function recordClip(text: string): boolean {
  const t = text.replace(/\r\n/g, '\n').trim();
  if (!t || t.length > CLIP_CHARS || isTokenLike(t)) return false;
  const now = Date.now();
  history = pruneClips([{ text: t, at: now }, ...history.filter(c => c.text !== t)], now);
  scheduleRepaint(now);
  emit();
  return true;
}

