// The ClaudeOS PIN lock. When the screen wakes from the ambient screen and a PIN is set (Settings → Security), a
// full-screen pad asks for it before anything shows. Not on app switches. The PIN is checked on the PC
// (/api/settings/pin/check), which keeps the PIN file. If the PC can't be reached and this tablet has its own copy of
// the PIN hash (pin-local.ts), the PIN is checked here. With no copy the lock says so and waits for "Try again": it
// never opens on its own. Back does not close it (system.ts), and nothing can open behind it (shell.ts).
import { critterSvg } from './critter-svg.ts';
import { esc, stageHeight, store } from './dom.ts';
import { padKey, padKeysHtml, paintDots, PAD_MAX, PAD_MIN } from './pin-pad.ts';
import { glanceLine } from './lock-glance.ts';
import { mediaActions, nowPlaying, onNowPlaying } from './media.ts';
import { I, nextAlarm, notifications, timerLeftText } from './system.ts';
import { checkCopyFingerprint, checkLocally, clearLocalRecord, hasLocalPin, localLockedFor } from './pin-local.ts';

interface Status { set: boolean; lockedFor: number; fingerprint?: string | null }
interface Result { ok: boolean; lockedFor?: number; left?: number; error?: string }
type Phase = 'checking' | 'pin' | 'cooldown' | 'retry';

const UNREACHABLE = 'Can’t reach your PC to check the PIN. Try again when it’s back.';
const ON_TABLET = 'Can’t reach your PC. Enter the PIN to unlock on this tablet.';
const TIMEOUT_MS = 8000;

const KNOWN_KEY = 'os.pinSet';        // '1' when the last check found a PIN set on the PC (so the lock shows at once)

/** Remember what the PC said (Settings and the lock both call this), so the next wake shows the lock without a delay. */
export function rememberPinSet(set: boolean): void { store.set(KNOWN_KEY, set ? '1' : '0'); }

let el: HTMLElement | null = null;
let shown = false;                   // the lock is up, or being checked
let phase: Phase = 'checking';
let typed = '';
let msg = '';
let until = 0;                       // when the cooldown ends (ms)
let tickTimer: number | undefined;

// the now-playing line follows the playing app while the lock is up (media.ts)
onNowPlaying(() => { if (el && !el.hidden) paintLockMedia(); });

/** The lock is up on screen: nothing else may open, and Back does not close it. */
export const lockShowing = (): boolean => shown && !!el && !el.hidden;
/** The lock is up or still being checked: Back (system.ts) never closes it, even before the pad shows. */
export const lockBusy = (): boolean => shown;

const $ = <T extends Element = HTMLElement>(sel: string): T => el!.querySelector(sel) as T;

// The lock is a full page in two columns: the time, the date and the critter on the left, the PIN pad on the right.
// It stays role="dialog" with aria-modal: it covers everything and nothing behind it can be reached until it closes.
function build(): void {
  if (el) return;
  el = document.createElement('div');
  el.id = 'lock';
  el.className = 'lock';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'ClaudeOS is locked');
  el.innerHTML = `<div class="lock-in">
    <div class="lock-face">
      <div class="lock-time num"></div>
      <div class="lock-date"></div>
      ${critterSvg('lock-crit')}
      <div class="lock-caption">ClaudeOS is locked</div>
      <div class="lock-glance"></div>
      <div class="lock-media" hidden></div>
    </div>
    <div class="lock-pad">
      <div class="pin-dots"></div>
      <div class="pin-msg" aria-live="polite"></div>
      <div class="pin-keys">${padKeysHtml()}</div>
      <button type="button" class="pin-done" disabled>Unlock</button>
    </div>
  </div>`;
  $('.pin-keys').addEventListener('click', e => press(padKey(e)));
  // the pause control of what plays (media.ts): it never unlocks
  $('.lock-media').addEventListener('click', ev => {
    if (!(ev.target as Element).closest('[data-lock-media]')) return;
    try { mediaActions()?.toggle(); } catch { /* the app that plays is busy */ }
  });
  $<HTMLButtonElement>('.pin-done').addEventListener('click', () => void done());
  addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
  document.body.appendChild(el);
}

/** Scale the 1024-wide page to the whole screen, the same way dom.ts fits the stage (the lock covers any inset too). */
function fit(): void {
  if (!el || !shown) return;
  const vv = window.visualViewport;
  const vw = vv ? vv.width * vv.scale : innerWidth;
  const vh = vv ? vv.height * vv.scale : innerHeight;
  const h = stageHeight(vw, vh);
  el.style.setProperty('--lock-h', `${h}px`);
  el.style.setProperty('--lock-s', String(Math.min(vw / 1024, vh / h)));
}

// ---------- the clock: ticks on each new minute, only while the lock is up ----------
let clockTimer: number | undefined;
const timeFmt = (): Intl.DateTimeFormat => {
  const h24 = store.get('os.clock24');   // Settings → Date & time; unset follows the tablet's locale (format.ts clock())
  return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', ...(h24 == null ? {} : { hour12: h24 !== '1' }) });
};

function paintClock(): void {
  if (!el) return;
  const d = new Date();
  let hour = '', minute = '', period = '';
  for (const p of timeFmt().formatToParts(d)) {
    if (p.type === 'hour') hour = p.value; else if (p.type === 'minute') minute = p.value; else if (p.type === 'dayPeriod') period = p.value;
  }
  $('.lock-time').innerHTML = `${esc(hour)}:${esc(minute)}${period ? `<small>${esc(period)}</small>` : ''}`;
  $('.lock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  paintGlance();
}

/** The glance line: notification count, next alarm and running timer (counts and times only). */
function paintGlance(): void {
  if (!el) return;
  const alarm = nextAlarm();
  $('.lock-glance').textContent = glanceLine(notifications().length, alarm ? alarm.text : null, timerLeftText());
  paintLockMedia();
}

/** What plays, with its pause or play button (media.ts). Hidden when nothing plays. */
function paintLockMedia(): void {
  if (!el) return;
  const box = $('.lock-media'), m = nowPlaying(), a = mediaActions();
  if (!m) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = `<span class="lock-media-text">${esc(m.title)}</span>`
    + (a ? `<button type="button" class="lock-media-btn" data-lock-media="toggle" aria-label="${m.playing ? 'Pause' : 'Play'}">${m.playing ? I.pause : I.play}</button>` : '');
}

function startClock(): void {
  stopClock();
  fit();
  paintClock();
  const next = (): void => {
    clockTimer = window.setTimeout(() => { paintClock(); next(); }, 60_000 - Date.now() % 60_000 + 50);
  };
  next();
}

function stopClock(): void { clearTimeout(clockTimer); clockTimer = undefined; }

function cooldownText(): string {
  const secs = Math.max(1, Math.ceil((until - Date.now()) / 1000));
  return `Too many tries. Wait ${secs} ${secs === 1 ? 'second' : 'seconds'}.`;
}

function paint(): void {
  if (!el) return;
  paintDots($('.pin-dots'), typed.length);
  $('.pin-msg').textContent = phase === 'cooldown' ? cooldownText() : msg;
  $('.pin-keys').querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = phase !== 'pin'; });
  const done = $<HTMLButtonElement>('.pin-done');
  done.textContent = phase === 'retry' ? 'Try again' : 'Unlock';
  done.disabled = phase === 'retry' ? false : phase !== 'pin' || typed.length < PAD_MIN;
}

function press(k: string | null): void {
  if (phase !== 'pin' || !k) return;
  if (k === 'back') typed = typed.slice(0, -1);
  else if (typed.length < PAD_MAX) typed += k;
  msg = '';
  paint();
}

function close(): void {
  shown = false;
  typed = ''; msg = ''; phase = 'checking';
  clearInterval(tickTimer);
  stopClock();
  if (el) el.hidden = true;
  preview = false;
}

// Dev only (?device=mock): the lock is painted in a given phase without the PC, so its look can be checked. Unlock
// just closes it here; nothing is sent to the PC and no PIN is involved.
let preview = false;
/** Mock tablet only: show the lock in `p` ('pin', 'cooldown', 'retry' or 'checking'). Lock.ts is otherwise untouched. */
export function previewLock(p: Phase, secs = 25): void {
  build();
  shown = true; preview = true;
  el!.hidden = false;
  startClock();
  if (p === 'cooldown') cooldown(secs);
  else if (p === 'retry') retry();
  else { phase = p; typed = p === 'pin' ? '12' : ''; msg = p === 'pin' ? 'That’s not it. 2 tries left before a 30-second wait.' : ''; paint(); }
}
/** Mock tablet only: take the preview lock down. */
export function closePreviewLock(): void { if (preview) close(); }

function retry(): void {
  phase = 'retry'; typed = ''; msg = UNREACHABLE;
  if (el) el.hidden = false;
  paint();
}

function cooldown(secs: number): void {
  phase = 'cooldown'; typed = ''; msg = '';
  until = Date.now() + secs * 1000;
  clearInterval(tickTimer);
  tickTimer = window.setInterval(() => {
    if (Date.now() >= until) { clearInterval(tickTimer); phase = 'pin'; }
    paint();
  }, 1000);
  paint();
}

/** Is a PIN set on the PC, and is it cooling down. A PC without the PIN routes has no PIN. */
async function checkStatus(): Promise<void> {
  phase = 'checking'; typed = ''; msg = '';
  paint();
  let st: Status | null = null;
  try {
    const r = await fetch('/api/settings/pin', { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.status === 404) st = { set: false, lockedFor: 0 };
    else if (r.ok) { const j = await r.json() as Status; if (typeof j.set === 'boolean') st = j; }
  } catch { st = null; }
  if (!st) { if (hasLocalPin()) askOnTablet(); else retry(); return; }
  rememberPinSet(st.set);
  if (!st.set) { clearLocalRecord(); close(); return; }
  checkCopyFingerprint(st.fingerprint);
  if (el) el.hidden = false;
  if (st.lockedFor > 0) cooldown(st.lockedFor);
  else { phase = 'pin'; paint(); }
}

/** The PC can't be reached but this tablet has its PIN copy: the pad asks here (pin-local.ts). */
function askOnTablet(): void {
  if (el) el.hidden = false;
  const left = localLockedFor();
  if (left > 0) { cooldown(left); return; }
  phase = 'pin'; msg = ON_TABLET; paint();
}

async function post(url: string, body: unknown): Promise<Result | null> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.status === 404) return { ok: false, error: 'no_pin' };
    const j = await r.json() as Result;
    return j && typeof j.ok === 'boolean' ? j : null;
  } catch { return null; }
}

async function done(): Promise<void> {
  if (phase === 'retry') { void checkStatus(); return; }
  if (phase !== 'pin' || typed.length < PAD_MIN) return;
  if (preview) { close(); return; }   // mock preview: nothing is checked on the PC
  const pin = typed;
  phase = 'checking'; msg = '';
  paint();
  const r = await post('/api/settings/pin/check', { pin });
  if (r) { typed = ''; handle(r); return; }
  // The PC can't be reached: check against the tablet's own copy, when there is one (pin-local.ts)
  const local = hasLocalPin() ? await checkLocally(pin) : null;
  typed = '';
  if (!local) { retry(); return; }
  handle(local);
}

/** Show what a check said: unlocked, a cooldown, or a wrong try with the tries left. */
function handle(r: Result): void {
  if (r.ok || r.error === 'no_pin') { close(); return; }
  if (r.error === 'locked') { cooldown(r.lockedFor || 30); return; }
  phase = 'pin';
  if (r.error === 'save_failed') msg = 'The PC couldn’t check the PIN. Try again.';
  else if (r.left == null) msg = 'That’s not it. Try again.';
  else msg = `That’s not it. ${r.left} ${r.left === 1 ? 'try' : 'tries'} left before a 30-second wait.`;
  paint();
}

/**
 * The screen just woke from the ambient screen (system.ts): ask for the PIN if one is set. When the last check found
 * one, the lock is up at once (no app shows first); otherwise it appears only once the PC says a PIN is set.
 */
export function requireUnlock(): void {
  if (shown) return;
  build();
  shown = true;
  el!.hidden = store.get(KNOWN_KEY) !== '1';
  startClock();
  void checkStatus();
}
