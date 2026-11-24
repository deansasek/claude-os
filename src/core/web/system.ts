// Claude Home's own system layer, so the tablet feels like one product rather than a web page on Android:
//
//   Control center  swipe down from the top edge (or tap the little handle): time, battery, Wi-Fi,
//                   quick tiles (Wi-Fi, Do Not Disturb, "Hey Claude", low power, appearance, Desk mode, timer,
//                   Settings: a tap toggles, a long press opens its Settings section), brightness and volume, and
//                   recent notifications. It replaces Android's pull-down bar, which Desk mode closes.
//   Banners         notify({ title, body }) drops a banner from the top for a few seconds; tapping it
//                   opens the app that sent it, swiping it up dismisses it. They stay in the control
//                   center and in Settings → Notifications.
//   Ambient screen  after a few idle minutes the screen fades to a calm clock with the weather, the next
//                   alarm and the latest notice (and the backlight dims on the tablet). The first tap only
//                   wakes it. Anything asking for attention wakes it too.
//   Night dimming   on the tablet, the screen dims between 10 PM and 7 AM.
//   Battery watch   a low-battery heads-up and low power (tablet only). The battery itself shows on Home.
//   Back            Android's Back closes whatever is on top: keyboard, control center, a sheet.
//
// Preferences are per screen (localStorage), so the Nest Hub and the tablet can differ.
import { esc, getJson, report, store } from './dom.ts';
import { appLabel, groupNotices, parseMutedApps, toggleMutedApp, withoutNotice } from './notes-group.ts';
import { orderTiles, TILE_IDS } from './quick-order.ts';
import { FOCUS_MODES, modeSettings } from './focus-modes.ts';
import { device, onTablet, onVolume, voice } from './device.ts';
import { mediaActions, nowPlaying, onNowPlaying } from './media.ts';
import type { Battery } from './device.ts';
import { clock, untilText } from './format.ts';
import { clockTimerText, readClockTimers, runningLeftMs } from './clock-timer.ts';
import { Keyboard } from './keyboard.ts';
import { lockBusy, lockShowing, requireUnlock } from './lock.ts';
import { motionMs, reducedMotion } from './motion.ts';
import { mountFrame, startFrame, stopFrame } from './amb-photos.ts';
import { currentTheme, setThemeMode } from './theme.ts';

export interface Notice { title: string; body?: string; app?: string; icon?: string }
interface StoredNotice extends Notice { at: number }

interface SystemHooks { openApp(id: string): void; appIcon(id: string): string }
let hooks: SystemHooks;

/** Quiet hours: chimes and spoken alerts stop from `from` to `to` on the chosen days (0 = Sunday). */
export interface QuietHours { on: boolean; days: number[]; from: string; to: string; pauseWake: boolean }
/** What happens when Claude finishes, asks for an OK, or a timer or alarm goes off. */
type AlertKind ='done' | 'approval' | 'timer';
type AlertWay ='chime' | 'critter' | 'banner' | 'off';

// ---------- preferences ----------
const flag = (k: string, fallback: boolean): boolean => { const v = store.get(k); return v == null ? fallback : v === '1'; };
const setFlag = (k: string, v: boolean): void => store.set(k, v ? '1' : '0');
// The status cluster (status.ts) repaints on these: Do Not Disturb, quiet hours, low power, the battery percentage,
// and the control center opening (it marks the notices seen).
const sysListeners: (() => void)[] = [];
export function onSystemChange(fn: () => void): void { sysListeners.push(fn); }
function sysChanged(): void { sysListeners.forEach(f => { try { f(); } catch { /* ignore */ } }); }

export const prefs = {
  get ambientMin(): number { const v = store.get('os.ambientMin'); return v == null ? 5 : +v; },   // 0 = never
  set ambientMin(v: number) { store.set('os.ambientMin', String(v)); },
  get night(): boolean { return store.get('os.night') !== '0'; },
  set night(v: boolean) { store.set('os.night', v ? '1' : '0'); applyBrightness(); },
  /** The photo frame: the Photos library slowly behind the ambient clock (Settings → Display). On by default. */
  get photoFrame(): boolean { return flag('os.photoFrame', true); },
  set photoFrame(v: boolean) { setFlag('os.photoFrame', v); if (!v) stopFrame(true); else if (ambientOn) startFrame(); },
  get banners(): boolean { return store.get('os.banners') !== '0'; },
  set banners(v: boolean) { store.set('os.banners', v ? '1' : '0'); },
  /** the critter says its line out loud when tapped (Settings → Voice); on by default */
  get critterSpeaks(): boolean { return store.get('os.critterSpeak') !== '0'; },
  set critterSpeaks(v: boolean) { store.set('os.critterSpeak', v ? '1' : '0'); },
  /** the brightness you chose; night and ambient dim below it and restore it */
  get brightness(): number { const v = store.get('os.brightness'); return v == null ? .8 : +v; },
  set brightness(v: number) { store.set('os.brightness', String(v)); applyBrightness(); },
  // Notifications, Wellbeing, Appearance (Settings)
  get alerts(): Record<AlertKind, AlertWay> {
    const way = (k: AlertKind): AlertWay => {
      const v = store.get(`os.alert.${k}`);
      return v === 'chime' || v === 'critter' || v === 'off' ? v : 'banner';
    };
    return { done: way('done'), approval: way('approval'), timer: way('timer') };
  },
  setAlert(k: AlertKind, w: AlertWay): void { store.set(`os.alert.${k}`, w); },
  /** Chimes on or off: an alert set to Chime is silent when this is off (its notice still lands in the list). */
  get chimes(): boolean { return flag('os.chimes', true); },
  set chimes(v: boolean) { setFlag('os.chimes', v); },
  /** Do Not Disturb: no chimes, no spoken alerts and no banners. Notices still land in the list. */
  get dnd(): boolean { return flag('os.dnd', false); },
  set dnd(v: boolean) { setFlag('os.dnd', v); sysChanged(); },
  get quiet(): QuietHours {
    let q: Partial<QuietHours> = {};
    try { q = JSON.parse(store.get('os.quiet') || '{}') as Partial<QuietHours>; } catch { /* default */ }
    return { on: !!q.on, days: Array.isArray(q.days) ? q.days : [1, 2, 3, 4, 5, 6, 0], from: q.from || '22:00', to: q.to || '07:00', pauseWake: q.pauseWake !== false };
  },
  set quiet(q: QuietHours) { store.set('os.quiet', JSON.stringify(q)); sysChanged(); },
  /** Break reminders: 0 (off), 30, 60 or 90 minutes of continuous use. */
  get breakMin(): number { return +(store.get('os.breakMin') || 0); },
  set breakMin(v: number) { store.set('os.breakMin', String(v)); },
  /** How the break nudge arrives: a banner, or the critter says it. */
  get breakWay(): 'banner' | 'critter' { return store.get('os.breakWay') === 'critter' ? 'critter' : 'banner'; },
  set breakWay(v: 'banner' | 'critter') { store.set('os.breakWay', v); },
  /** Low power mode: dims the screen, reduces motion, pauses "Hey Claude", and shortens the ambient wait. */
  get lowPower(): boolean { return flag('os.lowPower', false); },
  set lowPower(v: boolean) { setFlag('os.lowPower', v); applyAppearance(); applyBrightness(); sysChanged(); },
  /** Turn low power on by itself below this battery level: 0 (never), 15, 20 or 30. */
  get lowAt(): number { return +(store.get('os.lowAt') || 0); },
  set lowAt(v: number) { store.set('os.lowAt', String(v)); },
  /** Wake word was paused by quiet hours or low power, and should come back when they end. */
  get wakePaused(): boolean { return flag('os.wakePaused', false); },
  set wakePaused(v: boolean) { setFlag('os.wakePaused', v); },
  /** The battery percentage beside the battery glyph in the status cluster (Settings → Appearance). On by default. */
  get battPct(): boolean { return store.get('os.battPct') !== '0'; },
  set battPct(v: boolean) { store.set('os.battPct', v ? '1' : '0'); sysChanged(); },
  /** Appearance and accessibility */
  get reduceMotion(): boolean { return flag('os.reduceMotion', false); },
  set reduceMotion(v: boolean) { setFlag('os.reduceMotion', v); applyAppearance(); },
  get contrast(): boolean { return flag('os.contrast', false); },
  set contrast(v: boolean) { setFlag('os.contrast', v); applyAppearance(); },
  get textLarge(): boolean { return flag('os.textLarge', false); },
  set textLarge(v: boolean) { setFlag('os.textLarge', v); applyAppearance(); },
  get replyWide(): boolean { return flag('os.replyWide', false); },
  set replyWide(v: boolean) { setFlag('os.replyWide', v); applyAppearance(); },
  /** Pop-ups: stay until you tap or swipe them away, rather than going after a few seconds. */
  get popupsStay(): boolean { return flag('os.popupsStay', false); },
  set popupsStay(v: boolean) { setFlag('os.popupsStay', v); },
};

const isNight =(d = new Date()): boolean => d.getHours() >= 22 || d.getHours() < 7;

/** Is it quiet hours right now (Settings → Notifications → Quiet hours)? */
export function quietNow(d = new Date()): boolean {
  const q = prefs.quiet;
  if (!q.on) return false;
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const a = toMin(q.from), b = toMin(q.to), m = d.getHours() * 60 + d.getMinutes(), day = d.getDay();
  if (a === b) return false;
  if (a < b) return q.days.includes(day) && m >= a && m < b;
  // overnight (22:00 to 07:00): the small hours belong to the evening before
  return (m >= a && q.days.includes(day)) || (m < b && q.days.includes((day + 6) % 7));
}

/** Android's auto-brightness is on: then ClaudeOS leaves the backlight to it. Set by Settings → Display. */
export const autoBrightness = { on: false };

// ---------- appearance: the classes Settings turns on, on the page ----------
/** Puts the accessibility and appearance choices on the page (core.css and the apps read these classes). */
export function applyAppearance(): void {
  const c = document.documentElement.classList;
  c.toggle('reduce-motion', prefs.reduceMotion || prefs.lowPower);
  c.toggle('low-power', prefs.lowPower);
  c.toggle('contrast', prefs.contrast);
  c.toggle('text-large', prefs.textLarge);
  c.toggle('reply-wide', prefs.replyWide);
}

// ---------- the critter speaks ----------
// A tapped critter says its line through the tablet's own voice (the same speak path as Claude's replies).
// Only on the tablet, and only if the setting is on. Not while the wake word is listening, nor over Claude's
// own speech. A new tap replaces the line being said (VoiceSpeaker flushes), so taps never queue up.
// Each line has its own id, so the 'spoken' of a line a new tap cut short can't clear the flag for the new one.
let critterNow = '', critterSpeaking = false, critterN = 0;
voice.on(e => { if (e.type === 'spoken' && e.id === critterNow) critterSpeaking = false; });
export function critterSpeak(text: string): void {
  if (!prefs.critterSpeaks || !voice.available || !text.trim()) return;
  try {
    const st = voice.state();
    if (st?.mode === 'listen') return;
    if (st?.speaking && !critterSpeaking) return;   // Claude is talking: leave it be
    critterNow = `critter-${++critterN}`;
    critterSpeaking = true;
    voice.speak(text, critterNow);
  } catch { critterSpeaking = false; /* the tablet app is too old, or busy */ }
}

// ---------- brightness: chosen, night, ambient ----------
let ambientOn = false;
function applyBrightness(): void {
  if (!onTablet || autoBrightness.on) return;   // with Android's auto-brightness on, the backlight is Android's to set
  const want = prefs.brightness;
  const night = prefs.night && isNight();
  let v = ambientOn ? (night ? .03 : .12) : night ? Math.min(want, .18) : want;
  if (prefs.lowPower) v = Math.min(v, .3);
  try { device.setBrightness(v); } catch { /* app too old */ }
}

// ---------- alerts: a chime, the critter, a banner, or nothing ----------
let chimeCtx: AudioContext | null = null;
/** A short two- or three-note chime through the media volume (level 1 is the fuller one, for an approval). */
export function chime(level = 0): void {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    chimeCtx ||= new Ctor();
    const ctx = chimeCtx, t0 = ctx.currentTime;
    const notes = level ? [660, 880, 990] : [880, 1320];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), s = t0 + i * .17;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(.0001, s); g.gain.exponentialRampToValueAtTime(.16, s + .03); g.gain.exponentialRampToValueAtTime(.0001, s + .5);
      o.connect(g).connect(ctx.destination); o.start(s); o.stop(s + .55);
    });
  } catch { /* no audio here */ }
}

/**
 * Tell the person something happened. The way is their choice in Settings → Notifications; Do Not Disturb
 * turns off chimes, speech and banners (the notice still goes in the list), and quiet hours mute chimes and speech.
 */
export function alertFor(kind: AlertKind | 'break', n: Notice, way?: AlertWay, appVisible = false): void {
  const w: AlertWay = way ?? (kind === 'break' ? prefs.breakWay : prefs.alerts[kind]);
  if (w === 'off' || prefs.dnd || (n.app && mutedApps().includes(n.app))) { notify(n, true); return; }
  if (w === 'banner') { notify(n, appVisible); return; }   // the app that sent it is on screen: no banner over it
  const quiet = quietNow();
  if (!quiet && w === 'chime' && prefs.chimes) chime(kind === 'approval' ? 1 : 0);
  if (!quiet && w === 'critter' && voice.available) {
    try { voice.speak(n.body ? `${n.title}. ${n.body}` : n.title, `alert-${Date.now()}`); } catch { /* the tablet app is busy */ }
  }
  notify(n, true);   // recorded in Recent, no banner
}

// ---------- wellbeing and the timed things: low power, quiet hours, break reminders ----------
let breakSince = Date.now(), breakNudged = false;
/** Low power's own battery check: turn it on below the chosen level (once, until it's charged again). */
function lowPowerCheck(b: Battery): void {
  if (!prefs.lowAt || prefs.lowPower) return;
  if (b.percent <= prefs.lowAt && !b.charging) {
    prefs.lowPower = true;
    notify({ title: 'Low power mode is on', body: `The battery is at ${b.percent}%. The screen is dimmer and “Hey Claude” is paused.`, app: 'settings' });
  }
}

/** Quiet hours and low power pause "Hey Claude", and resume it when they end (only if it was on). */
function syncWake(): void {
  if (!voice.available) return;
  try {
    const want = prefs.lowPower || (prefs.quiet.on && prefs.quiet.pauseWake && quietNow());
    if (want && !prefs.wakePaused && voice.state()?.wake) { voice.setWake(false); prefs.wakePaused = true; }
    else if (!want && prefs.wakePaused) { prefs.wakePaused = false; voice.setWake(true); }
  } catch { /* the tablet app is busy */ }
}

function breakCheck(): void {
  const now = Date.now();
  if (now - lastTouch > 5 * 60e3) { breakSince = now; breakNudged = false; }   // a few minutes away is a break
  const min = prefs.breakMin;
  if (!min || breakNudged || ambientOn || now - breakSince < min * 60e3) return;
  breakNudged = true;
  alertFor('break', { title: 'Time for a break', body: `You’ve been at it for ${min} minutes. Look away for a moment.`, app: 'settings' });
}

/** Run every minute or so from the shell: the checks above, and the ambient wait that low power shortens. */
function wellbeing(): void {
  syncWake();
  breakCheck();
}

// ---------- icons ----------
const svg = (d: string) => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const I = {
  wifi: svg('<path d="M5 13a16 16 0 0 1 22 0M9 17.5a10 10 0 0 1 14 0M13 22a4 4 0 0 1 6 0"/><circle cx="16" cy="25.5" r=".8" fill="currentColor"/>'),
  wifiOff: svg('<path d="M5 13a16 16 0 0 1 22 0M9 17.5a10 10 0 0 1 14 0M13 22a4 4 0 0 1 6 0" opacity=".35"/><path d="M6 6l20 20"/>'),
  moon: svg('<path d="M21 5.5a10.5 10.5 0 1 0 5.5 15A9 9 0 0 1 21 5.5z"/>'),
  sun: svg('<circle cx="16" cy="16" r="5"/><path d="M16 4v3M16 25v3M4 16h3M25 16h3M7.5 7.5l2.1 2.1M22.4 22.4l2.1 2.1M7.5 24.5l2.1-2.1M22.4 9.6l2.1-2.1"/>'),
  desk: svg('<rect x="5" y="8" width="22" height="15" rx="2.5"/><path d="M12 27h8M16 23v4"/>'),
  gear: svg('<path d="M6 10h11M23 10h3M6 22h3M15 22h11"/><circle cx="20" cy="10" r="3"/><circle cx="12" cy="22" r="3"/>'),
  rest: svg('<path d="M24 19.5A9.5 9.5 0 0 1 12.5 8a9.5 9.5 0 1 0 11.5 11.5z"/><path d="M20 6h4l-4 4h4"/>'),
  bright: svg('<circle cx="16" cy="16" r="4.5"/><path d="M16 5v2.5M16 24.5V27M5 16h2.5M24.5 16H27M8.2 8.2l1.8 1.8M22 22l1.8 1.8M8.2 23.8L10 22M22 10l1.8-1.8"/>'),
  play: svg('<path d="M11 7v18l14-9z" fill="currentColor"/>'),
  pause: svg('<path d="M11 7v18M21 7v18"/>'),
  prev: svg('<path d="M8 7v18"/><path d="M24 8v16l-12-8z" fill="currentColor"/>'),
  next: svg('<path d="M24 7v18"/><path d="M8 8v16l12-8z" fill="currentColor"/>'),
  vol: svg('<path d="M6 13v6h5l6 5V8l-6 5H6z"/><path d="M21.5 12.5a5 5 0 0 1 0 7M24.5 9.5a9 9 0 0 1 0 13"/>'),
  mute: svg('<path d="M6 13v6h5l6 5V8l-6 5H6z"/><path d="M21 13l6 6M27 13l-6 6"/>'),
  bell: svg('<path d="M9 21V14a7 7 0 0 1 14 0v7l2 2.5H7z"/><path d="M13.5 26.5a2.6 2.6 0 0 0 5 0"/>'),
  awake: svg('<path d="M3.5 16s4.5-7.5 12.5-7.5S28.5 16 28.5 16s-4.5 7.5-12.5 7.5S3.5 16 3.5 16z"/><circle cx="16" cy="16" r="3.5"/>'),
  clock: svg('<circle cx="16" cy="16" r="11"/><path d="M16 9v7l4.5 3"/>'),
  target: svg('<circle cx="16" cy="16" r="10.5"/><circle cx="16" cy="16" r="5"/><circle cx="16" cy="16" r="1" fill="currentColor"/>'),
  mic: svg('<rect x="12" y="4.5" width="8" height="14" rx="4"/><path d="M7.5 15a8.5 8.5 0 0 0 17 0M16 23.5v4"/>'),
  gauge: svg('<path d="M6 22a10 10 0 0 1 20 0"/><path d="M16 22l5-6"/>'),
  timer: svg('<circle cx="16" cy="18" r="10"/><path d="M16 13.5V18l3 2M13 4h6M16 4v4"/>'),
};

/** Signal bars for the status row (0–4). */
export function wifiBars(bars: number): string {
  const s = (n: number) => (bars >= n ? 'currentColor' : 'var(--t5)');
  return svg(`<path d="M5 13a16 16 0 0 1 22 0" stroke="${s(4)}"/><path d="M9 17.5a10 10 0 0 1 14 0" stroke="${s(3)}"/>`
    + `<path d="M13 22a4 4 0 0 1 6 0" stroke="${s(2)}"/><circle cx="16" cy="25.5" r=".8" fill="currentColor"/>`);
}

/** A battery drawn at the weight of the rail icons: the fill tracks the level, clay-red when low, olive and a bolt while charging. */
export function batteryGlyph(b: Battery): string {
  const low = b.percent <= 20 && !b.charging;
  const w = Math.max(2, Math.round(17 * Math.max(0, Math.min(100, b.percent)) / 10) / 10);
  const fill = low ? 'var(--hot)' : b.charging ? 'var(--olive)' : 'currentColor';
  return `<svg viewBox="0 0 32 32" class="batt-glyph" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">`
    + `<rect x="3.5" y="10" width="22" height="12" rx="3.2"/><path d="M28.2 14.3v3.4"/>`
    + `<rect x="6" y="12.5" width="${w}" height="7" rx="1.4" fill="${fill}" stroke="none"/>`
    + (b.charging ? `<path class="batt-bolt" d="M16.2 11.4l-3.4 5.2h4.4l-3.4 5" stroke-width="3.2"/><path d="M16.2 11.4l-3.4 5.2h4.4l-3.4 5" stroke-width="1.6"/>` : '')
    + `</svg>`;
}

// ---------- weather (for the ambient screen), from the Weather app's server ----------
interface Wx { temp: number; code: number; day: boolean; place: string | null; hi?: number; lo?: number }
let wx: Wx | null = null, wxAt = 0;

const WX_WORDS: [number[], string][] = [
  [[0], 'Clear'], [[1], 'Mostly clear'], [[2], 'Partly cloudy'], [[3], 'Cloudy'], [[45, 48], 'Fog'],
  [[51, 53, 55, 56, 57], 'Drizzle'], [[61, 63, 65, 66, 67], 'Rain'], [[80, 81, 82], 'Showers'],
  [[71, 73, 75, 77, 85, 86], 'Snow'], [[95, 96, 99], 'Thunderstorms'],
];
const wxWord = (code: number): string => WX_WORDS.find(([c]) => c.includes(code))?.[1] || '';
function wxGlyph(code: number, day: boolean): string {
  const cloud = '<path d="M10 24h13a5 5 0 0 0 .6-10A7 7 0 0 0 10.2 16 4 4 0 0 0 10 24z"/>';
  if (code <= 1) return svg(day ? '<circle cx="16" cy="16" r="5"/><path d="M16 5v2.5M16 24.5V27M5 16h2.5M24.5 16H27M8.2 8.2l1.8 1.8M22 22l1.8 1.8M8.2 23.8L10 22M22 10l1.8-1.8"/>'
    : '<path d="M21 6.5a10 10 0 1 0 5 14A8.5 8.5 0 0 1 21 6.5z"/>');
  if (code === 2) return svg(`${day ? '<path d="M11 9.5a5 5 0 0 1 8.6 2.2M8 13.5A5 5 0 0 1 9 11"/>' : ''}${cloud}`);
  if (code <= 48) return svg(code >= 45 ? '<path d="M6 12h20M8 17h16M6 22h20"/>' : cloud);
  if (code >= 95) return svg('<path d="M10 20h13a5 5 0 0 0 .6-10A7 7 0 0 0 10.2 12 4 4 0 0 0 10 20z"/><path d="M17 21l-3 5h4l-3 4"/>');
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return svg('<path d="M10 19h13a5 5 0 0 0 .6-10A7 7 0 0 0 10.2 11 4 4 0 0 0 10 19z"/><path d="M12 24h.01M16 27h.01M20 24h.01" stroke-width="3"/>');
  return svg('<path d="M10 19h13a5 5 0 0 0 .6-10A7 7 0 0 0 10.2 11 4 4 0 0 0 10 19z"/><path d="M12 23l-1 3M17 23l-1 3M22 23l-1 3"/>');
}

async function loadWeather(force = false): Promise<void> {
  if (!force && Date.now() - wxAt < 15 * 60e3) return;
  wxAt = Date.now();
  try {
    const r = await getJson<{ status: string; place?: string | null; current?: { temperature_2m: number; weather_code: number; is_day: number };
      daily?: { temperature_2m_max: number[]; temperature_2m_min: number[] } }>('/api/weather/forecast');
    if (r.status !== 'ok' || !r.current) { wx = null; return; }
    wx = { temp: r.current.temperature_2m, code: r.current.weather_code, day: !!r.current.is_day, place: r.place ?? null,
      hi: r.daily?.temperature_2m_max?.[0], lo: r.daily?.temperature_2m_min?.[0] };
    if (ambientOn) paintAmbient();
  } catch { wxAt = Date.now() - 13 * 60e3; /* try again in a couple of minutes */ }
}

// ---------- the next alarm, from the Clock app's saved state ----------
const timeText = (d: Date) => clock(d);
// Clock keeps a list in clock.alarms ({h, m, on, days: weekday numbers, empty = once, snooze}); older builds kept one in clock.alarm.
interface SavedAlarm { h: number; m: number; on: boolean; days?: number[]; snooze?: number | null; label?: string }
const labelText = (a: SavedAlarm): string => (typeof a.label === 'string' ? a.label.trim().slice(0, 40) : '');
/** The next alarm that rings within 12 hours (a snoozed one first): its words ("Alarm 7:00 AM tomorrow") and its label. */
interface NextAlarm { text: string; label: string }
export function nextAlarm(): NextAlarm | null {
  try {
    let list = JSON.parse(store.get('clock.alarms') || 'null') as SavedAlarm[] | null;
    if (!Array.isArray(list)) { const one = JSON.parse(store.get('clock.alarm') || 'null') as SavedAlarm | null; list = one ? [one] : []; }
    const now = new Date();
    const snoozed = list.filter(a => a.snooze && a.snooze > now.getTime() - 60e3).sort((a, b) => a.snooze! - b.snooze!)[0];
    if (snoozed) return { text: `Snoozed until ${timeText(new Date(snoozed.snooze!))}`, label: labelText(snoozed) };
    let best: { t: Date; a: SavedAlarm } | null = null;
    for (const a of list) {
      if (!a.on) continue;
      for (let d = 0; d < 8; d++) {   // the first matching day from today on
        const t = new Date(now); t.setDate(now.getDate() + d); t.setHours(a.h, a.m, 0, 0);
        if (t.getTime() <= now.getTime()) continue;
        if (a.days && a.days.length && !a.days.includes(t.getDay())) continue;
        if (!best || t < best.t) best = { t, a };
        break;
      }
    }
    if (!best || best.t.getTime() - now.getTime() > 12 * 3600e3) return null;
    const days = Math.round((new Date(best.t).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 864e5);
    const when = days === 1 ? ' tomorrow' : days > 1 ? ` ${best.t.toLocaleDateString([], { weekday: 'short' })}` : '';
    return { text: `Alarm ${timeText(best.t)}${when}`, label: labelText(best.a) };
  } catch { return null; }
}

/** The soonest running Clock timer: its time left in ms, or null (the Clock keeps the list under clock.timers). */
function timerLeft(): number | null {
  return runningLeftMs(readClockTimers(k => store.get(k)), Date.now());
}
/** "4 min", "1h 05m": the ambient screen repaints once a minute, so it counts in minutes. */
const leftText = (ms: number): string => (ms < 3600e3 ? `${Math.max(1, Math.ceil(ms / 60e3))} min` : untilText(ms));
/** Claude is waiting on you: its rail icon carries the badge (claude/web/index.ts sets it while a session waits or asks). */
const claudeWaiting = (): boolean => !!document.querySelector('.ri[data-app="claude"]')?.classList.contains('has-badge');

// ---------- markup ----------
function build(stage: HTMLElement): void {
  // the tablet's 2×4 grid: each tile's data-hold is the Settings section a long press opens (the tile's state is painted by paintTiles)
  const tiles = onTablet
    ? `<button class="cc-tile" data-tile="wifi" data-hold="wifi"><i class="cc-ic">${I.wifi}</i><b>Wi-Fi</b><span>–</span></button>
       <button class="cc-tile" data-tile="dnd" data-hold="sound"><i class="cc-ic">${I.moon}</i><b>Do Not Disturb</b><span>–</span></button>
       <button class="cc-tile" data-tile="hey" data-hold="voice"${voice.available ? '' : ' disabled'}><i class="cc-ic">${I.mic}</i><b>“Hey Claude”</b><span>${voice.available ? '–' : 'Not on this tablet'}</span></button>
       <button class="cc-tile" data-tile="low" data-hold="battery"><i class="cc-ic">${I.gauge}</i><b>Low power</b><span>–</span></button>
       <button class="cc-tile" data-tile="theme" data-hold="appearance"><i class="cc-ic" id="ccThemeIcon"></i><b>Appearance</b><span>–</span></button>
       <button class="cc-tile" data-tile="desk" data-hold="security"><i class="cc-ic">${I.desk}</i><b>Desk mode</b><span>–</span></button>
       <button class="cc-tile" data-tile="timer"><i class="cc-ic">${I.timer}</i><b>Timer</b><span>Not running</span></button>
       <button class="cc-tile" data-tile="focus-work"><i class="cc-ic">${I.target}</i><b>Work focus</b><span>Off</span></button>
       <button class="cc-tile" data-tile="focus-family"><i class="cc-ic">${I.target}</i><b>Family focus</b><span>Off</span></button>
       <button class="cc-tile" data-tile="focus-sleep"><i class="cc-ic">${I.target}</i><b>Sleep focus</b><span>Off</span></button>
       <button class="cc-tile" data-tile="keep"><i class="cc-ic">${I.awake}</i><b>Keep awake</b><span>Off</span></button>
       <button class="cc-tile" data-tile="clock"><i class="cc-ic">${I.clock}</i><b>Clock</b><span>–</span></button>
       <button class="cc-tile" data-tile="settings"><i class="cc-ic">${I.gear}</i><b>Settings</b><span>All options</span></button>`
    : `<button class="cc-tile" data-tile="theme" data-hold="appearance"><i class="cc-ic" id="ccThemeIcon"></i><b>Appearance</b><span>–</span></button>
       <button class="cc-tile" data-tile="rest"><i class="cc-ic">${I.rest}</i><b>Clock screen</b><span>Rest now</span></button>`;
  const cc = document.createElement('div');
  cc.className = 'cc'; cc.id = 'cc';
  cc.innerHTML = `
    <div class="cc-shade" id="ccShade"></div>
    <div class="cc-panel" id="ccPanel">
      <div class="cc-top">
        <div><div class="cc-time num" id="ccTime"></div><div class="cc-date" id="ccDate"></div></div>
        <div class="cc-status" id="ccStatus"></div>
      </div>
      <div class="cc-tiles${onTablet ? '' : ' two'}" id="ccTiles">${tiles}</div>
      <div class="cc-media" id="ccMedia" hidden></div>
      ${onTablet ? `<div class="cc-sliders">
        <label class="cc-slide"><i class="cc-ic">${I.bright}</i><input type="range" min="2" max="100" id="ccBright" aria-label="Brightness"></label>
        <label class="cc-slide"><i class="cc-ic" id="ccVolIcon">${I.vol}</i><input type="range" min="0" max="100" id="ccVol" aria-label="Volume"></label>
      </div>` : ''}
      <div class="cc-notes">
        <div class="cc-kick"><span>Notifications</span><span class="cc-kick-btns"><button class="cc-clear hit" id="ccAll">See all</button><button class="cc-clear hit" id="ccClear">Clear all</button></span></div>
        <div id="ccList"></div>
      </div>
      <div class="cc-grab"></div>
    </div>`;
  stage.appendChild(cc);

  const handle = document.createElement('div');
  handle.className = 'cc-handle'; handle.id = 'ccHandle';
  stage.appendChild(handle);

  const banner = document.createElement('button');
  banner.className = 'banner'; banner.id = 'banner';
  stage.appendChild(banner);

  const vol = document.createElement('div');
  vol.className = 'vol-hud'; vol.id = 'volHud'; vol.setAttribute('aria-hidden', 'true');
  vol.innerHTML = `<i class="vol-ic" id="volIc">${I.vol}</i><span class="vol-track"><i id="volFill"></i></span>`;
  stage.appendChild(vol);

  const amb = document.createElement('div');
  amb.className = 'amb'; amb.id = 'amb';
  amb.innerHTML = `<div class="amb-in" id="ambIn"><div class="amb-face">
      <div class="amb-time num" id="ambTime"></div>
      <div class="amb-date" id="ambDate"></div>
      <div class="amb-chips" id="ambChips"></div>
      <div class="amb-note" id="ambNote"></div>
      <div class="amb-critter">
        <i class="amb-z">z</i><i class="amb-z">z</i>
        <svg class="amb-crit" viewBox="0 0 14 9" shape-rendering="crispEdges" aria-hidden="true">
          <rect x="2" y="2.5" width="10" height="6" fill="#D97757"/><rect x="1" y="5" width="1.2" height="2" fill="#D97757"/><rect x="11.8" y="5" width="1.2" height="2" fill="#D97757"/>
          <g fill="#141413"><rect x="3.6" y="5.4" width="1.8" height=".5"/><rect x="8.6" y="5.4" width="1.8" height=".5"/></g>
        </svg>
      </div>
    </div></div><div class="amb-hint" aria-hidden="true">Tap to wake</div>`;
  stage.appendChild(amb);
  mountFrame(amb);
}

// ---------- control center ----------
const $s = (id: string) => document.getElementById(id) as HTMLElement;
let ccOpen = false;

function paintCC(): void {
  const now = new Date();
  $s('ccTime').textContent = timeText(now);
  $s('ccDate').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  let status = '';
  paintTiles();
  paintMedia();
  if (onTablet) {
    try {
      const w = device.wifi();
      status += `<span class="cc-stat">${w.enabled && w.ssid ? wifiBars(w.bars ?? 4) : I.wifiOff}</span>`;
    } catch { /* ignore */ }
    try {
      const b = device.battery();
      status += `<span class="cc-stat cc-batt${b.percent <= 20 && !b.charging ? ' low' : ''}">${batteryGlyph(b)}<span class="num">${b.percent}%</span></span>`;
    } catch { /* ignore */ }
    paintRange('ccBright', prefs.brightness);
    try {
      const v = device.volume().media;
      paintRange('ccVol', v);
      $s('ccVolIcon').innerHTML = v > 0 ? I.vol : I.mute;
    } catch { /* ignore */ }
  }
  $s('ccStatus').innerHTML = status;
  paintNotes();
}

/** A tile's on state (ink fill) and its sub-line. */
function tileState(t: string, on: boolean, sub: string): void {
  const el = $s('ccTiles').querySelector<HTMLElement>(`[data-tile="${t}"]`);
  if (!el) return;
  el.classList.toggle('on', on);
  const s = el.querySelector('span');
  if (s && s.textContent !== sub) s.textContent = sub;
}

/** "7 AM", "10:30 PM" for a saved "22:00" (quiet hours). */
function hmText(s: string): string {
  const [h, m] = s.split(':').map(Number), d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return timeText(d).replace(':00', '');
}

/** The Clock app's running timer, as the drawer shows it: "4:59", or "1:04:59" from an hour up. */
export function timerLeftText(): string | null {
  return clockTimerText(readClockTimers(k => store.get(k)), Date.now());
}

/** The timer tile: the countdown while the Clock app's timer runs (repainted each second while the drawer is open). */
function paintTimer(): void {
  const left = timerLeftText();
  tileState('timer', !!left, left ?? 'Not running');
}

/** The tiles' states and sub-lines. Each toggle's setter fires the system change, so this runs again on any change. */
/** The tiles' order: the saved one (Settings → Appearance → Quick controls), applied to the drawer's tile grid. */
export const tileOrder = (): string[] => orderTiles(store.get('os.ccOrder'));
export function setTileOrder(order: readonly string[]): void {
  store.set('os.ccOrder', JSON.stringify(orderTiles(JSON.stringify(order), TILE_IDS)));
  applyTileOrder();
}
function applyTileOrder(): void {
  if (!onTablet) return;
  const box = $s('ccTiles');
  for (const id of tileOrder()) {
    const el = box.querySelector<HTMLElement>(`[data-tile="${id}"]`);
    if (el) box.appendChild(el);   // appending each in turn lays them out in the saved order
  }
}
/**
 * A focus mode on (its id) or off (null). The mode sets Do Not Disturb, banners and chimes, and the apps it hides,
 * all at once (focus-modes.ts). Turning it off puts those back on. Routines are not changed.
 */
export function setFocus(id: string | null): void {
  for (const [k, v] of Object.entries(modeSettings(id))) store.set(k, v);
  sysChanged();
}
/** Keep awake: on or off, kept in the store and set on the tablet (the tile shows it). */
function keepAwakeToggle(): void {
  const on = store.get('os.keepAwake') !== '1';
  try { device.keepAwake(on); } catch { /* the tablet app is busy */ }
  store.set('os.keepAwake', on ? '1' : '0');
}

function paintTiles(): void {
  const dark = currentTheme() === 'dark';
  $s('ccThemeIcon').innerHTML = dark ? I.moon : I.sun;
  tileState('theme', dark, dark ? 'Dark' : 'Light');
  if (!onTablet) return;
  tileState('keep', store.get('os.keepAwake') === '1', store.get('os.keepAwake') === '1' ? 'On' : 'Off');
  tileState('clock', false, timeText(new Date()));
  for (const m of FOCUS_MODES) { const on = store.get('os.focusMode') === m.id; tileState(`focus-${m.id}`, on, on ? 'On' : 'Off'); }
  try {
    const w = device.wifi();
    tileState('wifi', !!w.ssid, w.enabled ? (w.ssid || 'Not connected') : 'Off');
  } catch { /* ignore */ }
  const q = prefs.quiet, dnd = prefs.dnd;
  const dndSub = q.on && quietNow() ? `${dnd ? 'On' : 'Quiet hours'} · until ${hmText(q.to)}`
    : dnd ? 'On' : q.on ? `Off · from ${hmText(q.from)}` : 'Off';
  tileState('dnd', dnd, dndSub);
  if (voice.available) {
    let wakeOn = false;
    try { wakeOn = !!voice.state()?.wake; } catch { /* the tablet app is busy */ }
    tileState('hey', wakeOn && !prefs.wakePaused, prefs.wakePaused ? 'Paused' : wakeOn ? 'On' : 'Off');
  }
  tileState('low', prefs.lowPower, prefs.lowPower ? 'On' : prefs.lowAt ? `Off · at ${prefs.lowAt}%` : 'Off');
  try {
    const s = device.setup();
    if (s) {
      const left = s.items.filter(i => !i.done && !i.optional).length;
      tileState('desk', s.kiosk, !s.kiosk ? 'Paused' : left ? `On · ${left} to set up` : 'On');
    }
  } catch { /* ignore */ }
  paintTimer();
}

/** The now-playing card: the playing app's title and buttons. Hidden when nothing plays (media.ts). */
function paintMedia(): void {
  const el = $s('ccMedia'), m = nowPlaying(), a = mediaActions();
  if (!m) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `${m.art ? `<img class="cc-media-art" src="${esc(m.art)}" alt="">` : '<span class="cc-media-art"></span>'}
    <div class="cc-media-text"><b>${esc(m.title)}</b><span>${esc(m.subtitle)}</span></div>
    <div class="cc-media-btns">
      ${a?.prev ? `<button class="cc-media-btn" data-media="prev" aria-label="Previous">${I.prev}</button>` : ''}
      <button class="cc-media-btn" data-media="toggle" aria-label="${m.playing ? 'Pause' : 'Play'}">${m.playing ? I.pause : I.play}</button>
      ${a?.next ? `<button class="cc-media-btn" data-media="next" aria-label="Next">${I.next}</button>` : ''}
    </div>`;
}

function paintRange(id: string, v: number): void {
  const el = $s(id) as HTMLInputElement;
  el.value = String(Math.round(v * 100));
  el.style.setProperty('--p', `${(+el.value - +el.min) / (+el.max - +el.min) * 100}%`);
}

export function controlCenterOpen(): boolean { return ccOpen; }
let ccTicker: number | undefined;   // the timer tile counts down once a second while the drawer is open
export function openControlCenter(): void {
  if (ccOpen) return;
  if (Keyboard.isOpen) Keyboard.close('nav');
  ccOpen = true;
  hideBanner();
  paintCC();
  $s('cc').classList.add('on');
  sendTop();
  report('cc:open');
  sysChanged();
  clearInterval(ccTicker);
  ccTicker = window.setInterval(paintTimer, 1000);
}
export function closeControlCenter(): void {
  if (!ccOpen) return;
  ccOpen = false;
  clearInterval(ccTicker); ccTicker = undefined;
  $s('cc').classList.remove('on');
  sendTop();
}

/** Open Settings at a section (wifi, display, notifications, battery, …). */
export function openSettings(section: string | null = null): void {
  closeControlCenter();
  dispatchEvent(new CustomEvent('hub:settings', { detail: section }));
  hooks.openApp('settings');
}

/** After Wi-Fi changes, the header's Wi-Fi mark and the tiles read it again (status.ts reads the device on a system change). */
function readWifiChanged(): void { sysChanged(); paintCC(); }

/** "Hey Claude" tile: on or off, as Settings → Voice does it. Paused (low power, quiet hours) it opens Voice instead. */
function heyTap(): void {
  if (!voice.available) return;
  if (prefs.wakePaused) { openSettings('voice'); return; }
  let on = false;
  try { on = !!voice.state()?.wake; } catch { /* the tablet app is busy */ }
  try { voice.setWake(!on); } catch { /* ignore: Settings shows the reason */ }
  setTimeout(() => { sysChanged(); paintCC(); }, 600);   // if Android is asking for the microphone, the state is read again after
}

function bindCC(stage: HTMLElement): void {
  const panel = $s('ccPanel'), shade = $s('ccShade');
  const scale = () => stage.getBoundingClientRect().height / stage.offsetHeight;
  // Android's own top edge: a quick swipe starting in its first --grab-top px is taken by Android (the page gets a
  // pointercancel; the tablet app then opens this pull-down itself, MainActivity.dispatchTouchEvent). Slower drags
  // there still reach the page, so the grab zone runs from the very top to GRAB px below that band; the handle sits
  // just below the band, where touches always arrive. In Desk mode the helper's strip is the band (no touches there).
  const grabTop = () => parseFloat(getComputedStyle(stage).getPropertyValue('--grab-top')) || 0;
  const GRAB = 48;           // stage px
  const FLICK = 0.5;         // px per ms
  const travel = () => panel.offsetHeight + 60;   // how far the closed panel sits above the top (core.css)

  // One gesture for the pull-down: a drag down from the grab zone or the handle opens it, a drag up on the panel closes
  // it. The panel and the shade follow the finger; on release they open or close past 30% of the panel or on a flick,
  // else they spring back. A second finger is ignored; a cancelled touch goes back to the state it started in.
  type Drag = { id: number; mode: 'open' | 'close'; cx0: number; cy0: number; t: number; v: number; lastDy: number; onHandle: boolean; live: boolean; dx: number; dy: number };
  let drag: Drag | null = null;
  // what the last drags did, for checking on the tablet over chrome://inspect: window.__ccTrace
  const trace: string[] = ((window as unknown as { __ccTrace?: string[] }).__ccTrace = []);
  const note = (s: string) => { trace.unshift(`${Math.round(performance.now())} ${s}`); trace.length = Math.min(trace.length, 40); };
  let swallow = false;       // the click at the end of a drag is not a tap on whatever is under it

  const sheetUp = () => !!document.querySelector('.app.on .st-sheet:not([hidden]), .app.on .pin:not([hidden])');
  // a list inside the panel that is scrolled down scrolls; it does not close the panel
  const scrolled = (el: HTMLElement) => {
    for (let n: HTMLElement | null = el; n && n !== stage; n = n.parentElement) if (n.scrollTop > 0) return true;
    return false;
  };
  const follow = (d: Drag, dy: number) => {
    const T = travel(), PH = T - 60;
    if (d.mode === 'open') {
      panel.style.transform = `translateY(${Math.min(0, dy - T)}px)`;
      shade.style.opacity = String(Math.min(1, Math.max(0, dy / PH)));
    } else {
      panel.style.transform = `translateY(${Math.max(-T, Math.min(0, dy))}px)`;
      shade.style.opacity = String(1 - Math.min(1, Math.max(0, -dy / PH)));
    }
  };

  stage.addEventListener('pointerdown', e => {
    if (drag || ambientOn || !e.isPrimary) return;
    const t = e.target as HTMLElement;
    if (ccOpen) {
      // a drag up on the panel or on the dimmed backdrop closes it
      if (!(panel.contains(t) || t === shade) || t.closest('input') || scrolled(t)) return;
      drag = { id: e.pointerId, mode: 'close', cx0: e.clientX, cy0: e.clientY, t: e.timeStamp, v: 0, lastDy: 0, onHandle: false, live: false, dx: 0, dy: 0 };
      note('down close');
      return;
    }
    const y = (e.clientY - stage.getBoundingClientRect().top) / scale();
    if (y > grabTop() + GRAB || Keyboard.isOpen || sheetUp() || stage.classList.contains('sw-on')) return;
    drag = { id: e.pointerId, mode: 'open', cx0: e.clientX, cy0: e.clientY, t: e.timeStamp, v: 0, lastDy: 0, onHandle: !!t.closest('.cc-handle'), live: false, dx: 0, dy: 0 };
    note(`down open y=${Math.round(y)} band=${Math.round(grabTop())}`);
  }, true);
  stage.addEventListener('pointermove', e => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    const dy = (e.clientY - d.cy0) / scale(), dx = (e.clientX - d.cx0) / scale();
    d.dx = dx; d.dy = dy;
    if (!d.live) {
      const wrongWay = d.mode === 'open' ? dy < -4 : dy > 4;
      if (wrongWay || (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy))) { drag = null; note('not a pull'); return; }   // sideways, or the wrong way
      if (Math.abs(dy) < 8) return;                                                        // not a drag yet
      d.live = true;
      note(`live ${d.mode}`);
      try { stage.setPointerCapture(e.pointerId); } catch { /* the drag still works without it */ }
      panel.style.transition = 'none'; shade.style.transition = 'none';
    }
    // velocity from windows of at least 10 ms: a burst of events in one frame is not a flick
    const dt = e.timeStamp - d.t;
    if (dt >= 10) { d.v = d.v * 0.4 + ((dy - d.lastDy) / dt) * 0.6; d.t = e.timeStamp; d.lastDy = dy; }
    follow(d, dy);
  }, true);
  // Chromium starts a scroll once a touch moves past its slop wherever touch-action allows panning (everything but
  // the handle), and then cancels the pointer: the drag died with a pointercancel. Consuming the touchmoves of a
  // pull that is going the right way stops that scroll; sideways or wrong-way moves are left to scroll as usual.
  stage.addEventListener('touchmove', e => {
    const d = drag;
    if (!d || !e.cancelable) return;
    if (d.live || (Math.abs(d.dx) <= Math.abs(d.dy) + 2 && (d.mode === 'open' ? d.dy >= 0 : d.dy <= 0))) e.preventDefault();
  }, { capture: true, passive: false });
  const end = (e: PointerEvent, cancelled: boolean) => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    note(`${cancelled ? e.type : 'up'} ${d.mode}${d.live ? ' live' : ''} dy=${Math.round(d.dy)}`);
    if (!d.live) { if (!cancelled && d.onHandle) openControlCenter(); return; }   // a tap on the handle opens it
    try { stage.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    const dy = (e.clientY - d.cy0) / scale(), PH = travel() - 60;
    let open: boolean;
    // a cancelled pull from the top edge is Android taking the swipe: the tablet app opens the pull-down itself
    // (window.hubPullDown), which may already have happened, so leave it as it is now rather than closing it
    if (cancelled && d.mode === 'open') {
      panel.style.transition = ''; panel.style.transform = ''; shade.style.transition = ''; shade.style.opacity = '';
      return;
    }
    if (cancelled) open = d.mode === 'close';
    else if (d.mode === 'open') open = dy > PH * 0.3 || (d.v > FLICK && dy > 16);
    else open = !(-dy > PH * 0.3 || (d.v < -FLICK && -dy > 16));
    swallow = true; setTimeout(() => { swallow = false; }, 400);
    // hand the panel back to its classes: they animate it on from where the finger let go
    panel.style.transition = ''; panel.style.transform = ''; shade.style.transition = ''; shade.style.opacity = '';
    if (open) openControlCenter(); else closeControlCenter();
  };
  stage.addEventListener('pointerup', e => end(e, false), true);
  stage.addEventListener('pointercancel', e => end(e, true), true);
  stage.addEventListener('lostpointercapture', e => end(e, true), true);
  stage.addEventListener('click', e => { if (swallow) { swallow = false; e.stopPropagation(); e.preventDefault(); } }, true);

  // close: tap the shade (the drag above closes it too)
  shade.addEventListener('click', closeControlCenter);

  // a long press (about half a second, still under 10 px) opens the tile's Settings section; the lift that follows is not a tap
  const ccTiles = $s('ccTiles');
  applyTileOrder();
  if (onTablet && store.get('os.keepAwake') === '1') { try { device.keepAwake(true); } catch { /* the tablet app is busy */ } }
  let holdT: number | undefined, held = false, hx = 0, hy = 0;
  const cancelHold = () => { clearTimeout(holdT); holdT = undefined; };
  ccTiles.addEventListener('pointerdown', e => {
    cancelHold(); held = false;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tile][data-hold]');
    if (!el || !e.isPrimary || el.hasAttribute('disabled')) return;
    hx = e.clientX; hy = e.clientY;
    holdT = window.setTimeout(() => { holdT = undefined; held = true; report(`cc:hold:${el.dataset.tile}`); openSettings(el.dataset.hold!); }, 500);
  });
  ccTiles.addEventListener('pointermove', e => { if (holdT && Math.hypot(e.clientX - hx, e.clientY - hy) > 10) cancelHold(); });
  ccTiles.addEventListener('pointerup', cancelHold);
  ccTiles.addEventListener('pointercancel', cancelHold);
  ccTiles.addEventListener('contextmenu', e => e.preventDefault());   // Android's long-press menu is not ours

  ccTiles.addEventListener('click', e => {
    if (held) { held = false; return; }   // the lift after a long press
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tile]')?.dataset.tile;
    if (!t) return;
    report(`cc:${t}`);
    if (t === 'theme') { setThemeMode(currentTheme() === 'dark' ? 'light' : 'dark'); paintCC(); }
    if (t === 'desk') { const s = device.setup(); if (s) { device.setKiosk(!s.kiosk); paintCC(); } }
    if (t === 'rest') { closeControlCenter(); setTimeout(sleep, motionMs('--dur-base') + 130); }   // once the panel has gone
    // Wi-Fi: on, a tap turns it on; off, a tap opens Network, where turning it off asks first (it cuts the PC link)
    if (t === 'wifi') {
      let on = false;
      try { on = device.wifi().enabled; } catch { /* ignore */ }
      if (on) openSettings('wifi');
      else { try { device.wifiEnable(true); } catch { /* ignore */ } setTimeout(() => { readWifiChanged(); }, 900); }
    }
    if (t === 'dnd') prefs.dnd = !prefs.dnd;          // sysChanged: the header cluster, Settings and these tiles
    if (t === 'hey') heyTap();
    if (t === 'low') prefs.lowPower = !prefs.lowPower;
    if (t === 'timer') { closeControlCenter(); hooks.openApp('clock'); dispatchEvent(new CustomEvent('hub:clock-tab', { detail: 'timer' })); }
    if (t === 'settings') openSettings();
    if (t.startsWith('focus-')) { const id = t.slice(6); setFocus(store.get('os.focusMode') === id ? null : id); paintCC(); }
    if (t === 'keep') { keepAwakeToggle(); paintCC(); }
    if (t === 'clock') { closeControlCenter(); hooks.openApp('clock'); }
  });
  if (onTablet) {
    const bind = (id: string, fn: (v: number) => void) => $s(id).addEventListener('input', () => {
      const el = $s(id) as HTMLInputElement;
      el.style.setProperty('--p', `${(+el.value - +el.min) / (+el.max - +el.min) * 100}%`);
      try { fn(+el.value / 100); } catch { /* ignore */ }
    });
    bind('ccBright', v => { prefs.brightness = Math.max(.02, v); });
    bind('ccVol', v => { device.setVolume('media', v); $s('ccVolIcon').innerHTML = v > 0 ? I.vol : I.mute; });
  }
  // the card's buttons run the playing app's actions; a failed one is ignored, as the other tiles are
  $s('ccMedia').addEventListener('click', ev => {
    const b = (ev.target as Element).closest<HTMLElement>('[data-media]');
    const a = mediaActions();
    if (!b || !a) return;
    const fn = b.dataset.media === 'toggle' ? a.toggle : b.dataset.media === 'next' ? a.next : a.prev;
    try { fn?.(); } catch { /* ignore */ }
  });
  // a logo that does not load is removed, so the card shows the blank block
  $s('ccMedia').addEventListener('error', ev => { if (ev.target instanceof HTMLImageElement) ev.target.remove(); }, true);
  $s('ccClear').addEventListener('click', clearNotifications);
  $s('ccAll').addEventListener('click', () => openSettings('notifications'));
  swipeNotices($s('ccList'));
  $s('ccList').addEventListener('click', e => {
    const mute = (e.target as HTMLElement).closest<HTMLElement>('[data-mute]')?.dataset.mute;
    if (mute !== undefined) { toggleMuteApp(mute); return; }
    if (swipeMoved) return;
    const app = (e.target as HTMLElement).closest<HTMLElement>('[data-app]')?.dataset.app;
    if (app) { closeControlCenter(); hooks.openApp(app); }
  });
}

// ---------- notifications ----------
const KEEP = 30;
let notes: StoredNotice[] = (() => { try { return JSON.parse(store.get('os.notes') || '[]') as StoredNotice[]; } catch { return []; } })();
const noteListeners: (() => void)[] = [];
function saveNotes(): void {
  notes = notes.slice(0, KEEP);
  store.set('os.notes', JSON.stringify(notes));
  if (ccOpen) paintNotes();
  noteListeners.forEach(f => { try { f(); } catch { /* ignore */ } });
}

/** Everything that's been notified, newest first (Settings → Notifications). */
export const notifications = (): readonly StoredNotice[] => notes;
export function clearNotifications(): void { notes = []; saveNotes(); report('notes:clear'); }
export function onNotificationsChange(fn: () => void): void { noteListeners.push(fn); }
/** Apps muted in the shade (Settings → Notifications, or the mute button on a group): their notices land in the list only. */
export const mutedApps = (): string[] => parseMutedApps(store.get('os.mutedApps'));
export function toggleMuteApp(app: string): void {
  store.set('os.mutedApps', JSON.stringify(toggleMutedApp(mutedApps(), app)));
  saveNotes();   // repaints the shade and Settings
  sysChanged();
}
/** Remove one notice from the list (a swipe). Its time is its key. */
export function dismissNotice(at: number): void { notes = withoutNotice(notes, at); saveNotes(); }
/** The icon an app shows in the rail (for notification rows elsewhere). */
export const appIcon = (id: string): string => hooks?.appIcon(id) || '';
export const openApp = (id: string): void => hooks?.openApp(id);

/** "now", "5 min", "2 hr", "Yesterday", "Mon" */
export function ago(at: number): string {
  const m = Math.round((Date.now() - at) / 60e3);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  if (m < 60 * 20) return `${Math.round(m / 60)} hr`;
  const d = new Date(at), y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], m < 7 * 1440 ? { weekday: 'short' } : { month: 'short', day: 'numeric' });
}

/** A small chevron on a row that opens an app (tapping it does something); rows without an app show none. */
const GO = '<i class="cc-go" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M6 3.5l4.5 4.5L6 12.5"/></svg></i>';

export function noteRow(n: StoredNotice, cls = 'cc-note'): string {
  return `<button class="${cls}" data-at="${n.at}" data-app="${esc(n.app || '')}">
      <span class="cc-note-ic">${n.icon || (n.app ? appIcon(n.app) : '')}</span>
      <span class="cc-note-txt"><b>${esc(n.title)}</b>${n.body ? `<span>${esc(n.body)}</span>` : ''}</span>
      <em>${ago(n.at)}</em>${n.app ? GO : ''}
    </button>`;
}

/** The rows grouped by app, each group headed by its app and a Mute (or Unmute) button. Notices with no app have no button. */
export function groupedNotesHtml(list: readonly StoredNotice[], cls = 'cc-note'): string {
  const muted = mutedApps();
  return groupNotices(list).map(g => {
    const head = g.app
      ? `<div class="nt-group"><span>${esc(appLabel(g.app))}</span><button class="nt-mute hit" data-mute="${esc(g.app)}">${muted.includes(g.app) ? 'Unmute' : 'Mute'}</button></div>`
      : '';
    return head + g.items.map(n => noteRow(n, cls)).join('');
  }).join('');
}

/** Swipe a notice sideways to remove it from the list. A tap still opens its app. */
let swipeMoved = false;
export function swipeNotices(root: HTMLElement): void {
  let id = -1, x0 = 0, dx = 0, row: HTMLElement | null = null;
  root.addEventListener('pointerdown', e => {
    row = (e.target as HTMLElement).closest<HTMLElement>('[data-at]');
    if (!row) return;
    id = e.pointerId; x0 = e.clientX; dx = 0; swipeMoved = false;
  });
  root.addEventListener('pointermove', e => {
    if (!row || e.pointerId !== id) return;
    dx = e.clientX - x0;
    if (Math.abs(dx) > 8) swipeMoved = true;
    if (swipeMoved) { row.style.transform = `translateX(${dx}px)`; row.style.opacity = String(1 - Math.min(.6, Math.abs(dx) / 300)); }
  });
  const end = (e: PointerEvent): void => {
    if (!row || e.pointerId !== id) return;
    const r = row, at = +(r.dataset.at || 0);
    row = null; id = -1;
    if (swipeMoved && Math.abs(dx) > 90) {
      r.style.transform = `translateX(${dx < 0 ? -420 : 420}px)`; r.style.opacity = '0';
      setTimeout(() => dismissNotice(at), 160);
    } else { r.style.transform = ''; r.style.opacity = ''; }
    setTimeout(() => { swipeMoved = false; }, 0);   // the click that follows a swipe does nothing
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
}

function paintNotes(): void {
  $s('ccList').innerHTML = notes.length ? groupedNotesHtml(notes.slice(0, 3)) : '<div class="cc-none">You’re all caught up.</div>';
  $s('ccClear').hidden = !notes.length;
  $s('ccAll').hidden = !onTablet || notes.length <= 3;
}

let bannerTimer: number | undefined;
function hideBanner(): void { clearTimeout(bannerTimer); $s('banner').classList.remove('on'); }

/** Show a banner (unless the sending app is already on screen) and keep it in the control center. */
export function notify(n: Notice, appVisible = false): void {
  notes = [{ ...n, at: Date.now() }, ...notes.filter(x => x.title !== n.title || x.app !== n.app)];
  saveNotes();
  if (appVisible || !prefs.banners || (n.app && mutedApps().includes(n.app))) return;
  wake();
  if (ccOpen) return;   // it's already in the open list
  const b = $s('banner');
  b.innerHTML = `<span class="cc-note-ic">${n.icon || (n.app ? appIcon(n.app) : '')}</span>`
    + `<span class="cc-note-txt"><b>${esc(n.title)}</b>${n.body ? `<span>${esc(n.body)}</span>` : ''}</span><em>now</em>${n.app ? GO : ''}`;
  b.onclick = () => { hideBanner(); if (n.app) hooks.openApp(n.app); };
  b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
  clearTimeout(bannerTimer);
  // long enough to read a two-line body; "stay" pop-ups wait for a tap or a swipe
  if (!prefs.popupsStay) bannerTimer = window.setTimeout(hideBanner, 8000);
}

function bindBanner(stage: HTMLElement): void {
  // swipe a banner up to dismiss it (a tap still opens the app)
  const b = $s('banner');
  let y0: number | null = null;
  b.addEventListener('pointerdown', e => { y0 = e.clientY; clearTimeout(bannerTimer); });
  b.addEventListener('pointermove', e => {
    if (y0 == null) return;
    const scale = stage.getBoundingClientRect().height / stage.offsetHeight;
    const dy = Math.min(0, (e.clientY - y0) / scale);
    b.classList.toggle('dragging', dy < 0);   // follow the finger exactly; let go and it eases home or away
    b.style.transform = `translateY(${dy}px)`;
    if (dy < -28) { y0 = null; b.classList.remove('dragging'); b.style.transform = ''; b.onclick = null; hideBanner(); }
  });
  const end = () => { if (y0 != null) { y0 = null; b.classList.remove('dragging'); b.style.transform = ''; if (!prefs.popupsStay) bannerTimer = window.setTimeout(hideBanner, 4000); } };
  b.addEventListener('pointerup', end);
  b.addEventListener('pointercancel', end);
}

// ---------- volume HUD: a small pill when the tablet's volume changes (keys or this page), gone after a moment ----------
let volTimer: number | undefined;
function showVolume(level: number): void {
  const l = Math.max(0, Math.min(1, level)), hud = $s('volHud');
  $s('volFill').style.width = `${l * 100}%`;
  $s('volIc').innerHTML = l > 0 ? I.vol : I.mute;
  hud.classList.add('on');
  clearTimeout(volTimer);
  volTimer = window.setTimeout(() => hud.classList.remove('on'), 1500);
}

// ---------- ambient screen ----------
let lastTouch = Date.now();
let ambMinute = -1;   // the minute the ambient screen last painted (it repaints once a minute)

function paintAmbient(): void {
  const now = new Date();
  ambMinute = now.getMinutes();
  // 12-hour time keeps its AM/PM, set small beside the digits so 7:00 is never read as the wrong half of the day
  const hm = timeText(now), ap = /\s?([AP]M)$/i.exec(hm);
  $s('ambTime').innerHTML = esc(hm.replace(/\s?[AP]M$/i, '')) + (ap ? `<span class="amb-ap">${ap[1].toUpperCase()}</span>` : '');
  $s('ambDate').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  // one line of what's next, most urgent first: Claude waiting on you (clay), a running timer, then the next alarm.
  // The alarm moves to the chips when the line already says something else.
  const alarm = nextAlarm(), left = timerLeft(), waiting = claudeWaiting();
  const alarmWords = alarm ? esc(alarm.text) + (alarm.label ? ` · ${esc(alarm.label)}` : '') : '';
  const alarmOnLine = !waiting && left == null && !!alarm;
  let line = '';
  if (waiting) line = '<b class="amb-need"><i></i>Claude needs you</b>';
  else if (left != null) line = `<span>Timer · ${leftText(left)} left</span>`;
  else if (alarmOnLine) line = `<span>${alarmWords}</span>`;
  $s('ambNote').innerHTML = line;
  $s('ambNote').hidden = !line;
  const chips: string[] = [];
  if (wx) {
    const hiLo = wx.hi != null && wx.lo != null ? `<em>H ${Math.round(wx.hi)}°  L ${Math.round(wx.lo)}°</em>` : '';
    chips.push(`<span class="amb-chip">${wxGlyph(wx.code, wx.day)}<b class="num">${Math.round(wx.temp)}°</b>${esc(wxWord(wx.code))}${hiLo}</span>`);
  }
  if (alarm && !alarmOnLine) chips.push(`<span class="amb-chip">${I.bell}${alarmWords}</span>`);
  if (onTablet) {
    try {
      const b = device.battery();
      if (b.charging || b.percent <= 20) chips.push(`<span class="amb-chip${b.percent <= 20 && !b.charging ? ' low' : ''}">${batteryGlyph(b)}<span class="num">${b.percent}%</span>${b.full ? 'Charged' : b.charging ? 'Charging' : 'Low'}</span>`);
    } catch { /* ignore */ }
  }
  $s('ambChips').innerHTML = chips.join('');
  $s('amb').classList.toggle('night', isNight(now));
  // drift a little each minute so nothing burns in: one full sine cycle per hour, so the sideways drift
  // runs symmetric -12..+12px around centre (0 at minute 0), small enough to still read as centred
  $s('ambIn').style.transform = `translate(${Math.round(Math.sin(now.getMinutes() * Math.PI / 30) * 12)}px, ${Math.round(Math.cos(now.getMinutes() * 1.7) * 22)}px)`;
}

/** Fade to the ambient screen now (it also happens on its own after the idle time in Settings). */
export function sleep(): void {
  if (ambientOn) return;
  if (Keyboard.isOpen || ccOpen) return;
  ambientOn = true;
  hideBanner();
  void loadWeather();
  paintAmbient();
  $s('amb').classList.remove('waking');
  $s('amb').classList.add('on');
  $s('stage').classList.add('amb-on');   // core.css pauses every animation underneath it
  applyBrightness();
  sendTop();
  armAmbientMinute();
  if (prefs.photoFrame) startFrame(); else stopFrame(true);
}

// the ambient clock flips on the minute itself (the 20 s check below is only a backstop)
let ambTick: number | undefined;
function armAmbientMinute(): void {
  clearTimeout(ambTick);
  if (!ambientOn) return;
  ambTick = window.setTimeout(() => {
    if (!ambientOn) return;
    paintAmbient();
    armAmbientMinute();
  }, 60e3 - Date.now() % 60e3 + 20);
}

let wakeTimer: number | undefined;
/** Leave the ambient screen (a tap, or something asking for attention). */
export function wake(): void {
  lastTouch = Date.now();
  if (!ambientOn) return;
  ambientOn = false;
  clearTimeout(ambTick); ambTick = undefined;
  stopFrame();   // the photo frame's timers stop now; its picture goes once the screen has faded
  const amb = $s('amb'), stage = $s('stage');
  amb.classList.add('waking');
  amb.classList.remove('on');
  stage.classList.remove('waking', 'amb-on'); void stage.offsetWidth; stage.classList.add('waking');
  clearTimeout(wakeTimer);
  wakeTimer = window.setTimeout(() => { amb.classList.remove('waking'); stage.classList.remove('waking'); }, motionMs('--dur-slower') + 200);
  applyBrightness();
  sendTop();
  dispatchEvent(new Event('hub:ambient-off'));   // the header's clock catches up with the time at once (status.ts)
  requireUnlock();   // a PIN set on the PC asks before anything shows (lock.ts; does nothing when none is set)
}

// ---------- battery watch: low-battery heads-up and low power (the rail no longer shows the battery; Home does) ----------
let lowWarned = false;
function watchBattery(): void {
  if (!onTablet) return;
  const paint = () => {
    try {
      const b = device.battery();
      // one gentle heads-up when it runs low, not again until it's been charged
      if (b.percent <= 15 && !b.charging && !lowWarned) {
        lowWarned = true;
        notify({ title: `Battery low · ${b.percent}%`, body: 'Plug in ClaudeOS to keep it on.', app: 'settings' });
      }
      if (b.charging) lowWarned = false;
      lowPowerCheck(b);
    } catch { /* tablet app too old, or busy */ }
  };
  paint();
  setInterval(paint, 30e3);
}

// ---------- the tablet's top edge ----------
// On the tablet, Desk mode keeps a strip over Android's status bar. It can't show the page, so the page tells it
// what's along the top edge right now (sidebar, page, the pull-down and its dimmed backdrop, the ambient screen),
// as runs of colour in screen pixels. The drawer and banners also start below it.
interface TopApi { setTopColor?(hex: string): string; setTopBand?(runs: string): string; topInset?(): string; topGestureInset?(): string; bottomGestureInset?(): string }
const topApi = (): TopApi | undefined => (window as unknown as { HubDevice?: TopApi }).HubDevice;

function mix(hex: string, over: [number, number, number], a: number): string {
  const n = parseInt(hex.slice(1), 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255];
  return '#' + c.map((v, i) => Math.round(v * (1 - a) + over[i] * a).toString(16).padStart(2, '0')).join('');
}

let swShade = false;
/** The app switcher (switcher.ts) dims the whole stage, top edge included. */
export function setSwitcherShade(on: boolean): void { swShade = on; sendTop(); }

function sendTop(): void {
  const api = topApi();
  if (!api?.setTopBand) return;
  const css = getComputedStyle(document.documentElement), v = (n: string) => css.getPropertyValue(n).trim();
  const dpr = devicePixelRatio, px = (x: number) => Math.round(x * dpr), W = px(innerWidth);
  const bg = v('--bg'), rail = v('--rail'), line = v('--line');
  if (![bg, rail, line].every(c => /^#[0-9a-f]{6}$/i.test(c))) return;
  let runs: [number, number, string][];
  if (ambientOn) runs = [[0, W, '#0d0d0c']];
  // the app switcher's backdrop covers the whole top edge: one run in its dimmed colour (core.css .sw-shade;
  // the blur of a flat top band is the band itself)
  else if (swShade) {
    const dark = document.documentElement.dataset.theme === 'dark';
    runs = [[0, W, dark ? mix(bg, [0, 0, 0], .55) : mix(bg, [20, 20, 19], .6)]];
  }
  else {
    const r = document.getElementById('rail')!.getBoundingClientRect();
    // the pull-down's shade, or the app switcher's darker one (its blur is a flat colour at the very top)
    const shade = (c: string) => (ccOpen ? mix(c, [20, 20, 19], .28) : c);
    runs = [[0, px(r.left), shade(bg)], [px(r.left), px(r.right) - 1, shade(rail)], [px(r.right) - 1, px(r.right), shade(line)], [px(r.right), W, shade(bg)]];
    if (ccOpen) {
      const p = $s('ccPanel').getBoundingClientRect();
      runs.push([px(p.left), px(p.right), line], [px(p.left) + 1, px(p.right) - 1, bg]);
    }
  }
  try {
    api.setTopColor?.(bg);
    api.setTopBand(runs.filter(r => r[1] > r[0]).map(r => r.join(',')).join(';'));
    // keep our own overlays clear of the strip: its height in stage pixels
    const inset = JSON.parse(api.topInset?.() || '{"px":0}').px as number;
    const stage = $s('stage'), scale = stage.getBoundingClientRect().height / stage.offsetHeight;
    stage.style.setProperty('--sys-top', `${inset / dpr / scale}px`);
    // and where Android's own top gesture band ends (the pull-down's handle and grab zone, bindCC)
    const band = JSON.parse(api.topGestureInset?.() || JSON.stringify({ px: inset })).px as number;
    stage.style.setProperty('--grab-top', `${band / dpr / scale}px`);
    // and the bottom edge's: Android's own bottom gesture band (the switcher's handle and grab zone, switcher.ts)
    const bottom = (JSON.parse(api.bottomGestureInset?.() || '{"px":0}').px as number) || 0;
    stage.style.setProperty('--grab-bottom', `${bottom / dpr / scale}px`);
  } catch { /* older app */ }
}

// ---------- back ----------
// Back closes the topmost thing, then goes up one level inside the app, then goes Home (back() below).
// Overlays and apps register a handler with onBack(fn, priority). fn returns true when it closed something, and
// false when nothing of its own is open (so it checks its own state first). Handlers run highest priority first;
// among equals, the most recently registered runs first (a LIFO stack). Shell overlays (the switcher, 50 and up)
// come before the control center and the banner; app handlers (below 50) come after them. The returned function
// removes the handler again.
interface BackEntry { fn: () => boolean; prio: number; seq: number }
const backStack: BackEntry[] = [];
let backSeq = 0;
export function onBack(fn: () => boolean, prio = 0): () => void {
  const e: BackEntry = { fn, prio, seq: ++backSeq };
  backStack.push(e);
  return () => { const i = backStack.indexOf(e); if (i >= 0) backStack.splice(i, 1); };
}
/** Run the handlers whose priority is in [min, max), topmost first. True when one of them handled Back. */
function runBack(min: number, max: number): boolean {
  return [...backStack]
    .filter(e => e.prio >= min && e.prio < max)
    .sort((a, b) => b.prio - a.prio || b.seq - a.seq)
    .some(e => { try { return e.fn(); } catch { return false; } });
}

function back(): void {
  if (lockBusy()) return;   // the PIN lock, up or being checked: Back never closes it
  if (Keyboard.isOpen) { Keyboard.close('cancel'); return; }
  if (ambientOn) { wake(); return; }
  if (runBack(50, Infinity)) return;      // the welcome, the app switcher
  if (ccOpen) { closeControlCenter(); return; }
  if ($s('banner').classList.contains('on')) { hideBanner(); return; }
  if (runBack(-Infinity, 50)) return;     // the apps: their sheets, viewers, edit modes, one level up
  // any sheet still open that no app registered: close the top-most one
  const sheets = [...document.querySelectorAll<HTMLElement>('.app.on .st-sheet:not([hidden]), .app.on .pin:not([hidden])')];
  if (sheets.length) { sheets[sheets.length - 1].hidden = true; return; }
  const backBtn = document.querySelector<HTMLElement>('.app.on .backnow:not([hidden])');
  if (backBtn && backBtn.offsetParent) { backBtn.click(); return; }
  // nothing above the app's top level: Home (Home is the top, so there Back does nothing)
  if (!document.getElementById('app-home')?.classList.contains('on')) openApp('home');
}

export function initSystem(stage: HTMLElement, h: SystemHooks): void {
  hooks = h;
  build(stage);
  bindCC(stage);
  bindBanner(stage);
  watchBattery();
  // the control center has its own volume slider, so the HUD stays out of its way while it's open
  onVolume(level => { if (!ccOpen) showVolume(level); });
  onNowPlaying(() => { if (ccOpen) paintMedia(); });
  // a toggle made anywhere (a tile, Settings, low power kicking in) repaints the open tiles
  onSystemChange(() => { if (ccOpen) paintCC(); });
  stage.classList.toggle('on-tablet', onTablet);

  // first tap on the ambient screen only wakes it
  $s('amb').addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); wake(); }, true);
  document.addEventListener('pointerdown', () => { lastTouch = Date.now(); }, true);
  setInterval(() => {
    // low power shortens the wait before the ambient screen (two minutes at most)
    const base = prefs.ambientMin, min = prefs.lowPower ? (base ? Math.min(base, 2) : 2) : base;
    if (min && !ambientOn && Date.now() - lastTouch > min * 60e3) sleep();
    if (ambientOn) {   // the ambient clock moves once a minute (its weather is cached for 15 minutes)
      void loadWeather();
      const m = new Date().getMinutes();
      if (m !== ambMinute) { ambMinute = m; paintAmbient(); }
    }
    if (ccOpen) paintCC();
    applyBrightness();   // night begins / ends
    wellbeing();         // quiet hours, low power's wake word, break reminders
  }, 20e3);
  autoBrightness.on = device.screen()?.auto ?? false;   // Android's own auto-brightness, as Settings → Display shows it
  applyAppearance();
  wellbeing();
  applyBrightness();
  (window as unknown as { hubBack: () => void }).hubBack = back;
  // the tablet paints the strip over Android's status bar in our background colour; keep it in step with the theme
  sendTop();
  setTimeout(sendTop, 1500);   // after fonts and the stage have settled
  addEventListener('resize', sendTop);
  new MutationObserver(sendTop).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  // the tablet app calls this when Desk mode closes Android's pull-down: show ours instead
  (window as unknown as { hubPullDown: () => void }).hubPullDown = () => { wake(); if (!lockShowing()) openControlCenter(); };
}
