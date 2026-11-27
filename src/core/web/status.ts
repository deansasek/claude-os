// ClaudeOS's own status indicators: the cluster on the right of every app's header, in place of Android's status
// bar (which is hidden). Always: the time, Wi-Fi and the battery. Only while they're active, in this order: the mic
// listening, Claude speaking, a timer counting down (or ringing), a download, Do Not Disturb or quiet hours, low power,
// and a dot for notices you haven't seen. Tapping it opens the control center (system.ts).
//
//   addStatus(header, appId)  the shell gives each app's header its cluster (once, before the apps mount)
//   initStatus()              starts it: a tick on each new minute, and every second only while a timer runs
//
// Home hides the time (its hero has the clock) and keeps Wi-Fi, the battery and the active indicators. Ambient and the sign-in sheet's inset hide
// the cluster (core.css). The time, Wi-Fi and battery are read on each new minute and on resume, since the tablet has
// no event for them; voice, downloads, notices and settings push their own changes, and the Clock app's timer writes
// (the hub:store event) start or stop the countdown at once. Under low power the countdown moves every 15 seconds.
import { onStore, store } from './dom.ts';
import { hubReachable, onHubReachable } from './hub-link.ts';
import { browser, device, onResume, onTablet, voice, type Battery, type BrowserEvent } from './device.ts';
import { clock } from './format.ts';
import { CLOCK_TIMERS_KEY, CLOCK_TIMER_KEY, readClockTimers } from './clock-timer.ts';
import { voiceUi } from './voice-ui.ts';
import { I, batteryGlyph, controlCenterOpen, notifications, onNotificationsChange, onSystemChange, openControlCenter, prefs, quietNow, wifiBars } from './system.ts';

const K_RING = 'clock.ring', K_SEEN = 'os.notesSeen';   // the Clock app's ringing; when notices were last seen
const RING_C = 2 * Math.PI * 11;                                                 // the download ring's circumference (r = 11)

// the icons: the drawer's language (system.ts I), on the same 32 grid
const svg = (inner: string, attrs = '') => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${attrs}>${inner}</svg>`;
const MIC = svg('<rect x="12" y="4.5" width="8" height="14" rx="4"/><path d="M7.5 15a8.5 8.5 0 0 0 17 0M16 23.5v4"/>');
const TIMER = svg('<circle cx="16" cy="18" r="10"/><path d="M16 13.5V18l3 2M13 4h6M16 4v4"/>');
const GAUGE = svg('<path d="M6 22a10 10 0 0 1 20 0"/><path d="M16 22l5-6"/>');
const RING = svg('<circle cx="16" cy="16" r="11" stroke-width="3" opacity=".25"/><circle class="hd-arc" data-k="arc" cx="16" cy="16" r="11" stroke-width="3"/>', ' style="transform:rotate(-90deg)"');

interface Parts {
  root: HTMLElement; mic: HTMLElement; speak: HTMLElement; timer: HTMLElement; timerText: HTMLElement; ringing: HTMLElement;
  dl: HTMLElement; arc: SVGCircleElement; dnd: HTMLElement; low: HTMLElement; unread: HTMLElement;
  wifi: HTMLElement; batt: HTMLElement; battIcon: HTMLElement; battText: HTMLElement; time: HTMLElement;
}
const parts: Parts[] = [];
let stage: HTMLElement;
const st = {
  online: true, bars: 4, batt: null as Battery | null,
  timerEnd: 0, ringing: false, listening: false, speaking: false,
  dl: new Map<number, { bytes: number; total: number }>(),
  muted: false, low: false, unread: 0,
  minute: -1,
};

// only touch the DOM when the value changed (the tick runs every second)
const cache = new WeakMap<Element, string>();
function setHtml(el: HTMLElement, html: string): void { if (cache.get(el) !== html) { cache.set(el, html); el.innerHTML = html; } }
function setText(el: HTMLElement, text: string): void { if (el.textContent !== text) el.textContent = text; }
const pad = (n: number) => String(n).padStart(2, '0');
/** "4:59", or "1:04:59" from an hour up. Rounds up, so it reads 0:00 only when the timer is done. */
function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** The cluster for one app's header. Tapping it, or Enter on it, opens the control center. */
export function addStatus(header: HTMLElement, appId: string): void {
  const root = document.createElement('div');
  root.className = 'hd-status' + (appId === 'home' ? ' no-time' : '');
  root.setAttribute('role', 'button');
  root.tabIndex = 0;
  root.innerHTML =
    `<span class="hd-ic hd-mic" data-k="mic" hidden>${MIC}</span>`
    + `<span class="hd-ic hd-speak" data-k="speak" hidden>${I.vol}</span>`
    + `<span class="hd-timer" data-k="timer" hidden>${TIMER}<span class="num" data-k="timerText"></span></span>`
    + `<span class="hd-ic hd-ringing" data-k="ringing" hidden>${I.bell}</span>`
    + `<span class="hd-ic hd-dl" data-k="dl" hidden>${RING}</span>`
    + `<span class="hd-ic" data-k="dnd" hidden>${I.moon}</span>`
    + `<span class="hd-ic" data-k="low" hidden>${GAUGE}</span>`
    + `<span class="hd-dot" data-k="unread" hidden></span>`
    + `<span class="hd-ic hd-base" data-k="wifi"></span>`
    + `<span class="hd-batt hd-base" data-k="batt" hidden><span class="hd-ic" data-k="battIcon"></span><span class="num" data-k="battText"></span></span>`
    + `<span class="hd-base hd-time num" data-k="time"></span>`;
  header.appendChild(root);
  const q = <T extends Element = HTMLElement>(k: string) => root.querySelector<T>(`[data-k="${k}"]`)!;
  parts.push({
    root, mic: q('mic'), speak: q('speak'), timer: q('timer'), timerText: q('timerText'), ringing: q('ringing'),
    dl: q('dl'), arc: q<SVGCircleElement>('arc'), dnd: q('dnd'), low: q('low'), unread: q('unread'),
    wifi: q('wifi'), batt: q('batt'), battIcon: q('battIcon'), battText: q('battText'), time: q('time'),
  });
  root.addEventListener('click', () => openControlCenter());
  root.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openControlCenter(); } });
}

// ---------- reading the state ----------
function readDevice(): void {
  if (!onTablet) { st.online = navigator.onLine; st.bars = 4; st.batt = null; return; }
  try { const w = device.wifi(); st.online = !!(w.enabled && w.ssid); st.bars = w.bars ?? 4; } catch { st.online = false; }
  try { st.batt = device.battery(); } catch { st.batt = null; }
}

/** The Clock app's saved timer and ringing state (localStorage, so cheap to read every second). */
function readClock(): void {
  let end = 0;
  for (const t of readClockTimers(k => store.get(k))) {   // the soonest running timer
    if (t.end && t.end > Date.now() && (!end || t.end < end)) end = t.end;
  }
  let ringing = false;
  try { ringing = !!JSON.parse(store.get(K_RING) || 'null'); } catch { /* not ringing */ }
  st.timerEnd = end;
  st.ringing = ringing;
}

function readVoice(): void {
  st.listening = voiceUi.isListening();
  st.speaking = voiceUi.isSpeaking();
}

/** Quiet, low power, and the count of notices not yet seen (those after the last time the control center opened). */
function recompute(): void {
  st.muted = prefs.dnd || (prefs.quiet.on && quietNow());
  st.low = prefs.lowPower;
  const seen = +(store.get(K_SEEN) || 0);
  st.unread = notifications().filter(n => n.at > seen).length;
}

function markSeen(): void { store.set(K_SEEN, String(Date.now())); }

// ---------- downloads (the Browser's events) ----------
function onBrowser(e: BrowserEvent): void {
  if (e.type !== 'download' || e.id == null) return;
  if (e.state === 'start' || e.state === 'running') st.dl.set(e.id, { bytes: e.bytes ?? 0, total: e.total ?? 0 });
  else st.dl.delete(e.id);   // done, failed or gone
  paint();
}

/** A download that finished without its event reaching us is dropped, checked once a minute. */
function reconcileDownloads(): void {
  if (!st.dl.size || !onTablet) return;
  try {
    const running = new Set(browser.downloadsInfo([...st.dl.keys()]).filter(d => d.state === 'running').map(d => d.id));
    for (const id of [...st.dl.keys()]) if (!running.has(id)) st.dl.delete(id);
  } catch { st.dl.clear(); }
}

// ---------- painting ----------
function paintCountdown(now: number): void {
  if (!st.timerEnd) return;
  const text = countdown(st.timerEnd - now);
  for (const p of parts) setText(p.timerText, text);
}

function paint(): void {
  const now = Date.now(), time = clock(new Date(now)), b = st.batt;
  const low = !!b && b.percent < 15 && !b.charging;
  let bytes = 0, total = 0;
  for (const d of st.dl.values()) { bytes += d.bytes; total += d.total; }
  const frac = total > 0 ? Math.min(1, bytes / total) : -1;   // -1: no size yet, so the ring spins
  const up = st.online && hubReachable();
  const label = `Status: ${time}${st.online ? '' : ', offline'}${st.online && !hubReachable() ? ', PC not reached' : ''}${b ?`, battery ${b.percent}%${b.charging ? ', charging' : ''}` : ''}. Open the control center.`;
  for (const p of parts) {
    p.root.setAttribute('aria-label', label);
    p.mic.hidden = !st.listening;
    p.speak.hidden = !st.speaking;
    p.ringing.hidden = !st.ringing;
    p.timer.hidden = !st.timerEnd;
    p.dl.hidden = !st.dl.size;
    p.dl.classList.toggle('spin', st.dl.size > 0 && frac < 0);
    p.arc.style.strokeDasharray = frac < 0 ? '17 52' : `${RING_C} ${RING_C}`;
    p.arc.style.strokeDashoffset = frac < 0 ? '0' : String(RING_C * (1 - Math.max(0, frac)));
    p.dnd.hidden = !st.muted;
    p.low.hidden = !st.low;
    p.unread.hidden = !st.unread;
    setHtml(p.wifi, up ? wifiBars(st.bars) : I.wifiOff);
    p.batt.hidden = !b;
    if (b) {
      setHtml(p.battIcon, batteryGlyph(b));
      setText(p.battText, `${b.percent}%`);
      p.battText.hidden = !prefs.battPct;
      p.batt.classList.toggle('low', low);
    }
    setText(p.time, time);
  }
  paintCountdown(now);
}

// ---------- the tick ----------
let wasAmbient = false, timerH: number | undefined;
/** When the next tick is due. Only a running timer needs seconds (every 15 s in low power, as the countdown
 *  steps); otherwise the cluster wakes on each new minute. Ambient hides it, so it only checks the minute. */
function tickDelay(): number {
  const now = Date.now();
  if (st.timerEnd > 0 && !stage.classList.contains('amb-on')) {
    const step = prefs.lowPower ? 15e3 : 1e3;
    return step - now % step + 20;
  }
  return 60e3 - now % 60e3 + 30;
}
/** Once a minute, or once a second while a timer runs. A new minute reads the device (time, Wi-Fi, battery,
 *  downloads); a timer starting, ringing or stopping repaints; otherwise only the countdown moves. Ambient: the
 *  cluster is hidden, so it only notes that it was away and reads again on the next tick. */
function tick(): void {
  clearTimeout(timerH); timerH = undefined;
  try {
    if (stage.classList.contains('amb-on')) { wasAmbient = true; return; }
    const now = new Date(), minute = now.getHours() * 60 + now.getMinutes();
    const fresh = wasAmbient || minute !== st.minute;
    wasAmbient = false;
    const before = `${st.timerEnd}|${st.ringing}`;
    readClock();
    if (fresh) {
      st.minute = minute;
      readDevice(); readVoice(); recompute(); reconcileDownloads();
      paint();
    } else if (before !== `${st.timerEnd}|${st.ringing}`) paint();
    else paintCountdown(Date.now());
  } finally {
    timerH = window.setTimeout(tick, tickDelay());
  }
}

/** Start it (after initSystem, once the headers have their clusters). */
export function initStatus(): void {
  stage = document.getElementById('stage')!;
  if (!store.get(K_SEEN)) markSeen();   // the notices already there are not new
  voice.on(e => { if (e.type !== 'level' && e.type !== 'partial') setTimeout(() => { readVoice(); paint(); }, 0); });   // after voice-ui has its state
  browser.on(onBrowser);
  onResume(() => { readDevice(); readClock(); readVoice(); recompute(); paint(); });
  onHubReachable(() => paint());   // the PC went away or came back: the Wi-Fi icon and label follow
  // a toggle (Do Not Disturb, low power, Wi-Fi from its tile or Settings) repaints the cluster at once
  onSystemChange(() => { if (controlCenterOpen()) markSeen(); readDevice(); recompute(); paint(); });
  onNotificationsChange(() => { recompute(); paint(); });
  // the Clock app's timer or ringing changed: pick up the new state now, and start (or stop) the one-second countdown
  // the 12/24-hour switch in Settings changes the time's text: forget the minute so the next tick repaints it
  onStore(k => {
    if (k === 'os.clock24') st.minute = -1;
    if (k === 'os.clock24' || k === CLOCK_TIMERS_KEY || k === CLOCK_TIMER_KEY || k === K_RING) tick();
  });
  addEventListener('hub:ambient-off', () => tick());   // the ambient screen went away: the time is right at once
  recompute();
  readVoice();
  tick();
}
