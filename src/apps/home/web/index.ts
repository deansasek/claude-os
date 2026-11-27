// The Home app: the first screen, a calm overview of the day that ties the other apps together.
//   Left     a greeting, the time and date, and one sentence about what needs you (a waiting Claude session).
//   Right    the critter, living through the day: the real sky, sleepy at night, a "!" when a session waits,
//            the spark turning while Claude works. Tap it for a line. Under it, the shopping list and notifications.
//   Glance   Weather, Claude usage, Clock and Today (the calendar) in four columns (tap one to go there).
//   Actions  New session, then quiet buttons: a 5-minute timer, the rest screen, up to two routines or scenes, Settings.
// Everything is read-only: the Weather and Claude apps' server routes, the Clock app's saved state, and the
// system's notifications. Live parts refresh every 30 seconds and whenever Home comes on screen.
// For testing, ?hour=23 (and &min=59) shifts this app's clock, like the Clock app; &mock=waiting|working|approval fakes Claude.
import { esc, getJson, onStore, params, postJson, report, store } from '../../../core/web/dom.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import type { HaResult, HaScenes } from '../../home-assistant/api.ts';
import type { CalEvents } from '../../calendar/api.ts';
import { loadRoutines, onRunState, startRoutine, runState, stopRoutine } from '../../routines/web/run.ts';
import { onResume, onTablet } from '../../../core/web/device.ts';
import { INK, inkSay, inkedBlob, inkedShape, rng } from '../../../core/web/ink.ts';
import { nickname } from '../../../core/web/profile.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { ago, critterSpeak, notifications, onNotificationsChange, openApp, openControlCenter, openSettings, sleep } from '../../../core/web/system.ts';
import { manifest } from '../manifest.ts';
import { notesRow } from './notes-row.ts';
import { listsRow } from './lists-row.ts';
import { calendarRow, connectorCalAfterRead, dayKey, type ConnAnswer, type ConnRead, type RowCal } from './calendar-row.ts';
import { emptyTileText, weatherAfterRead } from './weather-read.ts';
import { isOffHome, sceneActsAfterRead, sceneFailText, type SceneAct } from './scene-words.ts';
import { busyOf, liveSessions, needsYou, pillText, type NeedTurn } from './needs.ts';
import { NATIVE_ID, nativeGlance, nativeLimits } from '../../claude/web/native.ts';
import { shortAge } from '../../../core/web/format.ts';
import { readLists } from '../../lists/web/readers.ts';
import { CLOCK_TIMERS_KEY, CLOCK_TIMER_KEY, readClockTimers } from '../../../core/web/clock-timer.ts';
import { parseClockAlarms } from '../../../core/web/clock-alarms.ts';

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const pad = (n: number) => String(n).padStart(2, '0');

// ---------- the time (with an optional test offset, as in the Clock app) ----------
const offset = (() => {
  const h = params.get('hour'), m = params.get('min');
  if (h == null && m == null) return 0;
  const real = new Date(), fake = new Date(real);
  if (h != null && !isNaN(+h)) fake.setHours(+h);
  if (m != null && !isNaN(+m)) fake.setMinutes(+m);
  return fake.getTime() - real.getTime();
})();
const now = (): Date => new Date(Date.now() + offset);

const hmFmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
function timeParts(d: Date): { hour: string; minute: string; period: string } {
  let hour = '', minute = '', period = '';
  for (const p of hmFmt.formatToParts(d)) {
    if (p.type === 'hour') hour = p.value; else if (p.type === 'minute') minute = p.value; else if (p.type === 'dayPeriod') period = p.value;
  }
  return { hour, minute, period };
}
const hm = (d: Date): string => { const t = timeParts(d); return `${t.hour}:${t.minute}${t.period ? ' ' + t.period : ''}`; };
/** "7:00" + "<small>AM</small>" for a tile value */
const hmBig = (d: Date): string => { const t = timeParts(d); return `${t.hour}:${t.minute}${t.period ? `<small>${esc(t.period)}</small>` : ''}`; };
function dur(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1e3)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
/** "in 40 min", "in 3 hr 10 min" */
function inWords(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60e3));
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return `in ${h} hr${r && h < 10 ? ` ${r} min` : ''}`;
}
/** "today", "tomorrow", or the weekday */
function dayWord(at: number, d: Date = now()): string {
  const t = new Date(at), tmr = new Date(d); tmr.setDate(d.getDate() + 1);
  if (t.toDateString() === d.toDateString()) return 'today';
  if (t.toDateString() === tmr.toDateString()) return 'tomorrow';
  return t.toLocaleDateString([], { weekday: 'long' });
}

type Phase = 'morning' | 'day' | 'evening' | 'night';
const phaseOf = (h: number): Phase => (h >= 22 || h < 6 ? 'night' : h < 10 ? 'morning' : h < 18 ? 'day' : 'evening');
const greeting = (h: number): string => (h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night');

// ---------- icons (line glyphs at the rail's weight) ----------
const svg = (d: string, w = 1.8) => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const HOME = appIcon('home');
const I = {
  plus: svg('<path d="M16 7v18M7 16h18"/>', 2),
  cloud: svg('<path d="M9 24h14a5.5 5.5 0 0 0 .6-11A7.5 7.5 0 0 0 9.2 15.2 4.4 4.4 0 0 0 9 24z"/>', 2),
};

// ---------- weather (the Weather app's server) ----------
type Sky = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';
const SKIES: Sky[] = ['clear', 'partly', 'cloudy', 'fog', 'rain', 'snow', 'storm'];
const skyOf = (code: number): Sky =>
  code <= 1 ? 'clear' : code === 2 ? 'partly' : code === 3 ? 'cloudy' : code <= 48 ? 'fog'
  : code >= 95 ? 'storm' : (code >= 71 && code <= 77) || code === 85 || code === 86 ? 'snow' : 'rain';
const WX_WORDS: [number[], string][] = [
  [[0], 'Clear'], [[1], 'Mostly clear'], [[2], 'Partly cloudy'], [[3], 'Cloudy'], [[45, 48], 'Foggy'],
  [[51, 53, 55, 56, 57], 'Drizzle'], [[61, 63, 65, 66, 67], 'Rain'], [[80, 81, 82], 'Showers'],
  [[71, 73, 75, 77, 85, 86], 'Snow'], [[95, 96, 99], 'Thunderstorms'],
];
const wxWord = (code: number): string => WX_WORDS.find(([c]) => c.includes(code))?.[1] || '';
function wxGlyph(code: number, day: boolean): string {
  const cloud = '<path d="M10 24h13a5 5 0 0 0 .6-10A7 7 0 0 0 10.2 16 4 4 0 0 0 10 24z"/>';
  const sky = skyOf(code);
  if (sky === 'clear') return svg(day ? '<circle cx="16" cy="16" r="5"/><path d="M16 5v2.5M16 24.5V27M5 16h2.5M24.5 16H27M8.2 8.2l1.8 1.8M22 22l1.8 1.8M8.2 23.8L10 22M22 10l1.8-1.8"/>'
    : '<path d="M21 6.5a10 10 0 1 0 5 14A8.5 8.5 0 0 1 21 6.5z"/>');
  if (sky === 'partly') return svg(`${day ? '<path d="M11 9.5a5 5 0 0 1 8.6 2.2M8 13.5A5 5 0 0 1 9 11"/>' : ''}${cloud}`);
  if (sky === 'cloudy') return svg(cloud);
  if (sky === 'fog') return svg('<path d="M6 12h20M8 17h16M6 22h20"/>');
  if (sky === 'storm') return svg('<path d="M10 20h13a5 5 0 0 0 .6-10A7 7 0 0 0 10.2 12 4 4 0 0 0 10 20z"/><path d="M17 21l-3 5h4l-3 4"/>');
  if (sky === 'snow') return svg('<path d="M10 19h13a5 5 0 0 0 .6-10A7 7 0 0 0 10.2 11 4 4 0 0 0 10 19z"/><path d="M12 24h.01M16 27h.01M20 24h.01" stroke-width="3"/>');
  return svg('<path d="M10 19h13a5 5 0 0 0 .6-10A7 7 0 0 0 10.2 11 4 4 0 0 0 10 19z"/><path d="M12 23l-1 3M17 23l-1 3M22 23l-1 3"/>');
}

interface Forecast {
  status: string;
  place?: string | null;
  current?: { time: string; temperature_2m: number; apparent_temperature?: number; weather_code: number; is_day: number };
  hourly?: { time: string[]; precipitation_probability: number[] };
  daily?: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] };
}
let wx: Forecast | null = null, wxAt = 0, wxFailed = false;
let sky: Sky | null = null;

// a forecast read the PC never answers gives up; each read takes a number, and only the newest read sets the forecast
const WX_TIMEOUT_MS = 20e3;
let wxSeq = 0;
async function loadWeather(force = false): Promise<void> {
  if (!force && Date.now() - wxAt < 10 * 60e3) return;
  wxAt = Date.now();
  const seq = ++wxSeq;
  try {
    const f = await getJson<Forecast>('/api/weather/forecast', WX_TIMEOUT_MS);
    if (seq !== wxSeq) return;   // a newer read (a new place or unit) started: its answer is the one that counts
    const r = weatherAfterRead(wx, f);
    wx = r.wx; wxFailed = r.failed;
    if (r.failed) wxAt = Date.now() - 8 * 60e3;   // a route error: try again in a couple of minutes
  }
  catch { if (seq !== wxSeq) return; wxFailed = true; wxAt = Date.now() - 8 * 60e3; /* try again in a couple of minutes */ }
  paintWeather();
}

/** When rain is likely later today: "around 3 PM" (from the hourly forecast, in the place's own time). */
function rainLater(f: Forecast): string | null {
  const h = f.hourly, cur = f.current?.time;
  if (!h || !cur) return null;
  const day = cur.slice(0, 10), hour = cur.slice(0, 13);
  for (let i = 0; i < h.time.length; i++) {
    const t = h.time[i];
    if (t.slice(0, 10) !== day) { if (t > hour) break; continue; }
    if (t.slice(0, 13) <= hour) continue;
    if ((h.precipitation_probability[i] ?? 0) >= 50) {
      const p = timeParts(new Date(2000, 0, 1, +t.slice(11, 13)));
      return `around ${p.period ? `${p.hour} ${p.period}` : `${p.hour}:00`}`;
    }
  }
  return null;
}

function paintWeather(): void {
  const f = wx;
  if (!f || f.status !== 'ok' || !f.current) {
    $('hmWxKick').textContent = 'Weather';
    $('hmWxIc').innerHTML = I.cloud;
    $('hmWxTemp').className = 'quiet';
    const empty = emptyTileText(f?.status, wxFailed);
    $('hmWxTemp').textContent = empty.temp;
    $('hmWxSub').textContent = empty.sub;
    setSky(null);
    return;
  }
  const c = f.current, d = f.daily;
  $('hmWxKick').textContent = f.place || 'Weather';
  $('hmWxIc').innerHTML = wxGlyph(c.weather_code, !!c.is_day);
  $('hmWxTemp').className = 'num';
  $('hmWxTemp').textContent = `${Math.round(c.temperature_2m)}°`;
  const hi = d?.temperature_2m_max?.[0], lo = d?.temperature_2m_min?.[0], rain = d?.precipitation_probability_max?.[0];
  // two short lines: the sky, then the high/low and the rain. The glance column is narrow (app.css), so each line stays short.
  const hiLo = hi != null && lo != null ? `H ${Math.round(hi)}° L ${Math.round(lo)}°` : '';
  const later = rainLater(f);
  const rainShort = later ? `Rain ${later}` : rain != null ? `${Math.round(rain)}% rain` : '';
  // the last read failed: this is the old forecast, so the tile says so rather than look current
  subLines($('hmWxSub'), [wxFailed ? `Offline · ${wxWord(c.weather_code)}` : wxWord(c.weather_code), [hiLo, rainShort].filter(Boolean).join(' · ')]);
  setSky(skyOf(c.weather_code));
}

/** A glance column's detail: each line on its own row, cut short rather than wrapped (app.css .hm-l). */
function subLines(el: HTMLElement, lines: string[]): void {
  el.innerHTML = lines.filter(Boolean).map(l => `<span class="hm-l">${esc(l)}</span>`).join('');
}

function setSky(s: Sky | null): void {
  sky = s;
  SKIES.forEach(k => ctx.root.classList.toggle(`hm-sky-${k}`, k === s));
}

// ---------- Claude (the Claude app's server; shapes kept local so Home only imports from core) ----------
interface LimitWindow { used: number | null; resets_at: string | null }
interface Session { id: string | null; title: string; folder: string; state: 'thinking' | 'tool' | 'waiting' | 'stalled'; age: number }
interface Usage {
  limits: { status: string; limits: Record<string, LimitWindow> };
  sessions: Session[];
  turns?: NeedTurn[];   // the Hub's turns: one waiting for your OK counts as needs you
  last_activity: string | null;
}
const MOCK = params.get('mock');
let usage: Usage | null = null, usageFailed = false;

// a usage read the PC never answers gives up before the 30 s poll runs again
const USAGE_TIMEOUT_MS = 20e3;
let usageSeq = 0;   // each read takes a number; only the newest read sets the usage

async function loadUsage(): Promise<void> {
  const seq = ++usageSeq;
  try {
    const u = await getJson<Usage>('/api/claude/usage', USAGE_TIMEOUT_MS);
    if (seq !== usageSeq) return;   // a newer read started: its answer is the one that counts
    usage = u; usageFailed = false;
  }
  catch { if (seq !== usageSeq) return; usageFailed = true; }
  if (usage && MOCK) {
    const base = { folder: 'storefront', age: 90 };
    if (MOCK === 'waiting') usage.sessions = [{ ...base, id: 'mock', title: 'Refactor checkout flow', state: 'waiting' }];
    if (MOCK === 'working') usage.sessions = [{ ...base, id: 'mock', title: 'Fix flaky upload test', state: 'tool', age: 3 }];
    if (MOCK === 'quiet') usage.sessions = [];
    if (MOCK === 'approval') { usage.sessions = [{ ...base, id: 'mock', title: 'Deploy staging', state: 'tool', age: 3 }]; usage.turns = [{ sessionId: 'mock', status: 'approval' }]; }
  }
  paintClaude();
}

const waitingSessions = (): Session[] => { const live = liveSessions(usage, usageFailed); return needsYou(live.sessions, live.turns); };
const busySessions = (): Session[] => { const live = liveSessions(usage, usageFailed); return busyOf(live.sessions, live.turns); };
const left = (w: LimitWindow | undefined): number | null => (w && w.used != null ? Math.round(100 - Math.min(100, Math.max(0, w.used))) : null);
const shortTitle = (t: string, n = 40) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

/** The tablet's own plan limits (native.ts), as percent left, with the session window's reset time. Null when the
 *  tablet has none. Used when the PC has none, or is away. */
function tabletLimits(): { s: number | null; w: number | null; resetMs: number | null } | null {
  const pct = (used: number | null | undefined): number | null => (used == null ? null : Math.round(100 - Math.min(100, Math.max(0, used))));
  const lim = nativeLimits();
  const five = lim.find(l => l.type === 'five_hour'), week = lim.find(l => l.type === 'seven_day');
  const s = pct(five?.used), w = pct(week?.used);
  if (s == null && w == null) return null;
  return { s, w, resetMs: five?.resetsAt ? Date.parse(five.resetsAt) : null };
}

/** The tablet chat's line on the Claude tile: working, or when it last replied. The reply text stays out (the kiosk is
 *  shared). Null when the tablet has no reply yet. */
function nativeLine(): string | null {
  const g = nativeGlance();
  if (g.running) return 'Claude is working on this tablet';
  return g.at && g.ago != null ? `Replied here · ${shortAge(g.ago)}` : null;
}

function paintClaude(): void {
  const waiting = waitingSessions(), busy = busySessions();
  ctx.root.classList.toggle('hm-waiting', waiting.length > 0);
  ctx.root.classList.toggle('hm-working', busy.length > 0);

  // header pill
  const pill = $('hmPill'), pillLabel = $('hmPillText');
  const p = pillText(usage, usageFailed, waiting, busy);
  pill.className = p.cls; pillLabel.textContent = p.text;

  // the tile
  const val = $('hmClVal'), sub = $('hmClSub');
  $('hmClDot').classList.toggle('on', waiting.length > 0);
  // the PC's limits; when the PC has none (or is away), the tablet's own (native.ts) before anything says Offline
  const L = usageFailed ? undefined : usage?.limits, pcS = left(L?.limits?.five_hour), pcW = left(L?.limits?.seven_day);
  const tab = pcS == null && pcW == null ? tabletLimits() : null;
  const s = tab ? tab.s : pcS, w = tab ? tab.w : pcW;
  if (s == null && w == null) {
    val.className = 'quiet';
    if (!usage || usageFailed) { val.textContent = usageFailed ? 'Offline' : '–'; sub.textContent = usageFailed ? 'Can’t reach the PC' : 'Loading usage…'; }
    else { val.textContent = 'Not connected'; sub.textContent = 'Plan limits aren’t connected yet'; }
  }
  else {
    val.className = `num${s != null && s < 15 ? ' clay' : ''}`;
    val.innerHTML = s != null ? `${s}%<small>left</small>` : `${w}%<small>left</small>`;
    const resets = tab ? tab.resetMs : (L?.limits?.five_hour?.resets_at ? Date.parse(L.limits.five_hour.resets_at) + offset : null);
    const lines = [s != null ? `Session${resets ? ` · resets ${hm(new Date(resets))}` : ''}` : 'This week'];
    if (s != null && w != null) lines.push(`${w}% left this week`);
    if (tab) lines.push('On this tablet');
    subLines(sub, lines);
  }
  const nat = nativeLine();
  if (nat) sub.insertAdjacentHTML('beforeend', `<span class="hm-l">${esc(nat)}</span>`);
  paintLine();
  paintStatus();
}

// ---------- the Clock app's saved state (localStorage) ----------
interface SavedAlarm { h: number; m: number; on: boolean; days?: number[]; snooze?: number | null }
interface SavedTimer { dur: number; end: number | null; left: number | null }
const readJson = <T>(k: string): T | null => { try { return JSON.parse(store.get(k) || 'null') as T; } catch { return null; } };

function nextAlarm(d: Date = now()): number | null {
  const list: SavedAlarm[] = parseClockAlarms(store.get('clock.alarms'), store.get('clock.alarm'));   // bad entries are left out
  let best: number | null = null;
  for (const a of list) {
    let t: number | null = null;
    if (a.snooze && a.snooze > Date.now() - 60e3) t = a.snooze + offset;   // snooze is saved in real time
    else if (a.on) {
      for (let k = 0; k < 8 && t == null; k++) {
        const c = new Date(d); c.setDate(d.getDate() + k); c.setHours(a.h, a.m, 0, 0);
        if (c.getTime() > d.getTime() && (!a.days?.length || a.days.includes(c.getDay()))) t = c.getTime();
      }
    }
    if (t != null && (best == null || t < best)) best = t;
  }
  return best;
}
const timerNow = (): SavedTimer | null => {   // the soonest running Clock timer, else a paused one (the list: clock-timer.ts)
  const timers = readClockTimers(k => store.get(k));
  const now = Date.now();
  const running = timers.filter(t => t.end && t.end > now).sort((a, b) => a.end! - b.end!)[0];
  return running ?? timers.find(t => !t.end && t.left != null) ?? null;
};

function paintClock(): void {
  const t = timerNow(), d = now();
  const kick = $('hmCkKick'), val = $('hmCkVal'), sub = $('hmCkSub');
  if (t?.end) {
    const ms = t.end - Date.now();
    kick.textContent = 'Timer';
    val.className = 'num clay'; val.textContent = dur(ms);
    sub.textContent = `Done at ${hm(new Date(t.end + offset))}`;
  } else if (t) {
    kick.textContent = 'Timer';
    val.className = 'num'; val.textContent = dur(t.left!);
    sub.textContent = 'Paused';
  } else {
    const at = nextAlarm(d);
    kick.textContent = 'Next alarm';
    if (at == null) { val.className = 'quiet'; val.textContent = 'No alarms'; sub.textContent = 'Tap to set one'; }
    else {
      val.className = 'num'; val.innerHTML = hmBig(new Date(at));
      const day = dayWord(at, d);
      sub.textContent = at - d.getTime() < 12 * 3600e3 ? `${day[0].toUpperCase()}${day.slice(1)} · ${inWords(at - d.getTime())}` : `${day[0].toUpperCase()}${day.slice(1)}`;
    }
  }
  ctx.root.classList.toggle('hm-timing', !!t?.end);
}

// ---------- the calendar (the Calendar app's server: GET /api/calendar/events, read-only) ----------
// The next three events still to come today (all-day ones first), with their times. The PC keeps its own copy of the
// calendar for 5 minutes, so asking every couple of minutes costs nothing; the words follow the clock each minute.
const CAL_EVERY_MS = 2 * 60e3;
let cal: RowCal | null = null, calAt = 0, calFailed = false;

// With no calendar address, Home reads the claude.ai connector's cached copy only (cached=1): Home never starts a Claude read.
// Nothing cached yet means the tile says to open the Calendar app.
let calMiss = false;
// The local day (YYYY-MM-DD) the connector events in cal were read on: a later miss on the same day keeps them, marked stale.
let calDay: string | null = null;
// The local day the last good read happened on. Events read on an earlier day have ended: a failed read after midnight shows none.
let calReadDay: string | null = null;
// a calendar read the PC never answers gives up before the next poll; each read takes a number, and only the newest one sets the tile
const CAL_TIMEOUT_MS = 20e3;
let calSeq = 0;
async function loadCalendar(force = false): Promise<void> {
  if (!force && Date.now() - calAt < CAL_EVERY_MS) return;
  calAt = Date.now();
  const seq = ++calSeq;
  try {
    const r = await getJson<CalEvents>('/api/calendar/events', CAL_TIMEOUT_MS);
    if (seq !== calSeq) return;   // a newer read started: its answer is the one that counts
    if (r.status === 'not_set') {
      const key = dayKey(now());
      const c = await cachedConnectorCal(cal, calDay, key);
      if (seq !== calSeq) return;
      cal = c.cal; calMiss = c.miss; calFailed = c.failed; calDay = c.day;
      calReadDay = key;
    }
    else { cal = r; calMiss = false; calFailed = false; calDay = null; calReadDay = dayKey(now()); }
  }
  catch {
    if (seq !== calSeq) return;
    calFailed = true;
    if (calReadDay !== dayKey(now())) cal = null;   // a read from an earlier day: its events have ended
  }
  paintCalendar();
}

// A non-ok answer (not a miss) is an error state: the tile says the PC cannot be reached, not "Reading the calendar…".
async function cachedConnectorCal(prev: RowCal | null, prevDay: string | null, todayKey: string): Promise<ConnRead> {
  type CE = ConnAnswer;
  const [t, m] = await Promise.all([getJson<CE>('/api/calendar/connector?day=today&cached=1', CAL_TIMEOUT_MS), getJson<CE>('/api/calendar/connector?day=tomorrow&cached=1', CAL_TIMEOUT_MS)]);
  return connectorCalAfterRead(prev, prevDay, t, m, todayKey);
}

// The Shopping tile: how many items are still to get, and the first two of them.
let lists: { items: { done: boolean; text: string }[] } | null = null, listsFailed = false;
async function loadLists(): Promise<void> {
  try {
    const all = await readLists();
    lists = all.find(l => l.id === 'shopping') ?? null;
    listsFailed = false;
  } catch { listsFailed = true; }
  paintLists();
}
function paintLists(): void {
  // a row beside its label: "3 to get · Milk, eggs…", or one plain phrase
  const val = $('hmLsVal'), sub = $('hmLsSub');
  const row = listsRow(lists, listsFailed);
  val.textContent = row.val;
  sub.textContent = row.sub;
}

function paintCalendar(): void {
  const val = $('hmCalVal'), sub = $('hmCalSub');
  $('hmCalKick').textContent = 'Today';
  const row = calendarRow(cal, calFailed, calMiss, now().getTime());   // the words live in calendar-row.ts
  val.className = row.cls;
  val.textContent = row.val;
  sub.textContent = row.sub;
}

// ---------- notifications ----------
function paintNotes(): void {
  // a row beside its label (a tap opens the notification list): "Claude finished · 11 hr", "3 new · Claude finished", "All caught up"
  const recent = notifications().filter(n => Date.now() - n.at < 24 * 3600e3);
  const { val, sub } = notesRow(recent, ago);
  $('hmNtVal').textContent = val;
  $('hmNtSub').textContent = sub;
}

// ---------- the sentence: what needs you ----------
let lineTarget: string | null = null;
function paintLine(): void {
  const waiting = waitingSessions(), busy = busySessions(), d = now(), ph = phaseOf(d.getHours());
  const el = $('hmLine');
  lineTarget = null;
  let html: string;
  if (waiting.length) {
    lineTarget = waiting[0].id;
    html = waiting.length > 1
      ? `<i></i>${waiting.length} sessions are waiting for you. <em>${esc(shortTitle(waiting[0].title, 34))} first.</em><span class="hm-chev">›</span>`
      : `<i></i>${esc(shortTitle(waiting[0].title))} <em>is waiting for you.</em><span class="hm-chev">›</span>`;
  } else {
    const lead = 'Nothing needs you right now.';
    const rest = busy.length ? (busy.length > 1 ? `Claude is busy on ${busy.length} sessions.` : `Claude is busy on ${shortTitle(busy[0].title, 34)}.`)
      : { morning: 'Have a good morning.', day: 'Enjoy the afternoon.', evening: 'Enjoy your evening.', night: 'Sleep well.' }[ph];
    html = `${esc(lead)} <em>${esc(rest)}</em>`;
  }
  el.innerHTML = html;
  el.classList.toggle('go', !!lineTarget);
  (el as HTMLButtonElement).disabled = !lineTarget;   // only a sentence about a waiting session is a button
}

/** Open the tablet's own chat in the Claude app: its session is NATIVE_ID (the Claude app listens for hub:open-session). */
function openTabletChat(): void {
  openApp('claude');
  dispatchEvent(new CustomEvent('hub:open-session', { detail: NATIVE_ID }));
  report('home:tablet-chat');
}

/** Open a session in the Claude app (the Claude app listens for hub:open-session). */
function openSession(id: string): void {
  openApp('claude');
  dispatchEvent(new CustomEvent('hub:open-session', { detail: id }));
  report('home:session');
}

// ---------- the critter ----------
type Act = 'hop' | 'stretch' | 'wave';
const ACT_MS: Record<Act, number> = { hop: 800, stretch: 2200, wave: 2400 };
let phase: Phase | null = null, acting = false, wokeTimer: number | undefined, taps = 0;

const say = (text: string): void => inkSay($('hmSay'), text);
function act(name: Act, force = false): void {
  if (acting && !force) return;
  (Object.keys(ACT_MS) as Act[]).forEach(n => ctx.root.classList.remove(`hm-act-${n}`));
  void ctx.root.offsetWidth;
  acting = true;
  ctx.root.classList.add(`hm-act-${name}`);
  setTimeout(() => { ctx.root.classList.remove(`hm-act-${name}`); acting = false; }, ACT_MS[name]);
}
function wake(ms = 3500): void {
  ctx.root.classList.add('hm-woke');
  clearTimeout(wokeTimer);
  wokeTimer = window.setTimeout(() => ctx.root.classList.remove('hm-woke'), ms);
}

/** The sun and a cloud, drawn by hand like the Clock app's: warm blobs with an ink outline. */
function drawSky(): void {
  const rnd = rng(11), cx = 24.8, cy = 4.2;
  const b = inkedBlob(cx, cy, 1.9, 1.85, rnd, 8, .05, [.06, .05], .05);
  let rays = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * 45 + rnd() * 8 - 90) * Math.PI / 180, r2 = 3.3 + rnd() * .3;
    rays += `<path d="M${(cx + 2.6 * Math.cos(a)).toFixed(2)} ${(cy + 2.6 * Math.sin(a)).toFixed(2)}L${(cx + r2 * Math.cos(a)).toFixed(2)} ${(cy + r2 * Math.sin(a)).toFixed(2)}"/>`;
  }
  $('hmSun').innerHTML = `<g class="hm-rays" stroke="${INK}" stroke-width=".14" stroke-linecap="round">${rays}</g>`
    + `<path d="${b.fill}" fill="var(--clay)" opacity=".9"/><path class="hm-ink" d="${b.line}" fill="none" stroke="${INK}" stroke-width=".13" stroke-linecap="round"/>`;
  const c = inkedShape([[6.5, 5.25], [6.35, 4.6], [6.9, 4.05], [7.7, 4.0], [8.2, 3.25], [9.1, 2.85], [10.0, 3.2], [10.4, 3.85],
    [11.1, 3.9], [11.75, 4.5], [11.6, 5.2], [9.1, 5.4]], [9.1, 4.3], [.07, .05], .05);
  $('hmCloud').innerHTML = `<path d="${c.fill}" fill="var(--cloud)"/><path d="${c.line}" fill="none" stroke="var(--text)" stroke-width=".11" stroke-linecap="round"/>`;
}

function setPhase(p: Phase, announce: boolean): void {
  if (p === phase) return;
  const first = phase === null;
  phase = p;
  ctx.root.classList.remove('hm-morning', 'hm-day', 'hm-evening', 'hm-night');
  ctx.root.classList.add(`hm-${p}`);
  if (!first && announce && ctx.isVisible()) {
    if (p === 'morning') { act('stretch', true); say('*yawn*… morning!'); }
    else if (p === 'evening') say('tea time');
    else if (p === 'night') say('night night…');
  }
}

const DAY_LINE: Record<Sky, string> = {
  clear: 'Out in the sun', partly: 'Sun and clouds', cloudy: 'Under grey skies', fog: 'Lost in the fog',
  rain: 'Staying dry inside', snow: 'Watching the snow', storm: 'Hiding from the storm',
};
function paintStatus(): void {
  const waiting = waitingSessions(), busy = busySessions(), t = timerNow();
  let s: string, sub: string;
  if (waiting.length) { s = 'Your turn'; sub = waiting.length > 1 ? `${waiting.length} sessions are waiting` : 'tap me to go there'; }
  else if (phase === 'night') { s = 'Fast asleep'; sub = busy.length ? 'Claude is still up working' : 'tap to say hi'; }
  else if (t?.end) { s = 'Watching the sand'; sub = `${dur(t.end - Date.now())} left on the timer`; }
  else if (busy.length) { s = 'Cheering Claude on'; sub = busy.length > 1 ? `${busy.length} sessions working` : 'a session is working'; }
  else { s = { morning: 'Waking up', day: sky ? DAY_LINE[sky] : 'Hanging out', evening: 'Winding down', night: 'Fast asleep' }[phase || 'day']; sub = 'tap me!'; }
  $('hmStatus').textContent = s;
  $('hmStatusSub').textContent = sub;
}

/** Something to say when tapped, from whatever's going on today. */
function tapLine(): string {
  const d = now(), h = d.getHours(), f = wx?.status === 'ok' ? wx : null;
  const lines: string[] = [];
  if (phase === 'night') return pick(['shh… it’s late', 'zzz… huh? oh, hi', 'five more minutes…', h < 5 ? 'still up?' : 'off to bed soon?']);
  if (f?.current) {
    const temp = Math.round(f.current.temperature_2m), word = wxWord(f.current.weather_code).toLowerCase();
    lines.push(`${temp}° and ${word}`);
    const later = rainLater(f);
    if (later) lines.push(`rain ${later}, take a coat`);
    else if (sky === 'clear' && f.current.is_day) lines.push('go get some sun!');
  }
  const t = timerNow();
  if (t?.end) lines.push(`${dur(t.end - Date.now())} to go…`);
  const al = nextAlarm(d);
  if (al != null && al - d.getTime() < 16 * 3600e3) lines.push(`alarm at ${hm(new Date(al))}`);
  const s = left(usage?.limits?.limits?.five_hour);
  if (s != null) lines.push(s > 60 ? 'plenty of Claude left' : s > 20 ? `${s}% of the session left` : 'easy on Claude for a bit');
  if (busySessions().length) lines.push('Claude’s on it');
  lines.push(phase === 'morning' ? 'morning!' : phase === 'evening' ? 'cozy evening' : 'hi there!', 'hello!');
  if (nickname()) lines.push(`hi, ${nickname()}!`);   // by name, once Settings → Profile has one
  return lines[taps % lines.length];
}

function onCritterTap(): void {
  report('home:critter');
  const waiting = waitingSessions();
  if (waiting.length && waiting[0].id) {
    // say where it's going (the bubble and the voice say the same line), then go after a moment to read it
    const w = waiting[0], line = `this way, to ${shortTitle(w.title, 32)}!`;
    act('hop', true); say(line); critterSpeak(line);
    clearTimeout(goT);
    goT = window.setTimeout(() => { goT = undefined; if (ctx.isVisible()) openSession(w.id!); }, 1100);   // only while Home is still on screen
    return;
  }
  taps++;
  if (phase === 'night') { wake(); act('stretch', true); }
  else act(pick<Act>(['hop', 'wave', 'hop']), true);
  const line = tapLine();
  say(line);
  critterSpeak(line);
}

// the critter's idle acts: only while Home is on screen (onShow starts them, onHide stops them)
let goT: number | undefined;   // the critter's walk to a waiting session: cancelled when Home is left
let actT: number | undefined;
function scheduleAct(): void {
  clearTimeout(actT);
  actT = undefined;
  if (!ctx.isVisible()) return;
  actT = window.setTimeout(() => {
    if (phase && phase !== 'night' && !document.hidden) act(phase === 'morning' ? pick<Act>(['stretch', 'hop']) : pick<Act>(['hop', 'wave', 'stretch']));
    scheduleAct();
  }, 30e3 + Math.random() * 40e3);
}

// ---------- quick actions ----------
// One ink button with its icon, then quiet ones in plain words. Settings sits at the row's right end, after the routines
// and scenes. (No Weather or All apps button: the Weather column opens Weather, and the rail's Apps opens the launcher.)
interface QuickAction { id: string; label: string; icon?: string; kind?: 'primary' | 'ghost'; end?: boolean; run(): void }
const ACTIONS: QuickAction[] = [
  { id: 'new', label: 'New session', icon: I.plus, kind: 'primary', run: () => {
    openApp('claude');
    dispatchEvent(new CustomEvent('hub:new-session'));   // the Claude app opens its "New session" screen when it listens for this
  } },
  { id: 'timer', label: '5-min timer', run: startTimer },
  { id: 'rest', label: 'Rest screen', run: () => sleep() },
  ...(onTablet ? [{ id: 'settings', label: 'Settings', kind: 'ghost' as const, end: true, run: () => openSettings() }] : []),
];

// ---------- Home Assistant scenes: up to three, chosen in Settings > Apps > Home Assistant ----------
// GET /api/home-assistant/scenes gives the picks; a tap posts /scene, which the PC
// checks again (only domain "scene", only a scene on Home). No scenes, or no answer: no scene buttons.
let sceneActs: SceneAct[] = [];
const sceneBusy = new Map<string, 'busy' | 'done' | 'fail'>();

// a scene list read the PC never answers gives up; each read takes a number, and only the newest read sets the buttons
const SCENES_TIMEOUT_MS = 20e3;
let scenesSeq = 0;
async function loadScenes(): Promise<void> {
  const seq = ++scenesSeq;
  let next: SceneAct[];
  try {
    const r = await getJson<HaScenes>('/api/home-assistant/scenes', SCENES_TIMEOUT_MS);
    if (seq !== scenesSeq) return;   // a newer read (after a change in Settings) started: its answer is the one that counts
    next = sceneActsAfterRead(sceneActs, r);
  } catch { /* the PC is away: keep what is shown */ return; }
  if (JSON.stringify(next) === JSON.stringify(sceneActs)) return;
  sceneActs = next;
  paintActs();
}

function paintActs(): void {
  const scene = (s: SceneAct) => {
    const st = sceneBusy.get(s.id);
    const label = st === 'done' ? 'Done' : st === 'fail' ? 'Couldn’t set' : s.name;
    return `<button class="hm-act hm-scene${st ? ` ${st}` : ''}" data-scene="${esc(s.id)}" title="${esc(s.name)}" aria-label="${esc(`Set the scene ${s.name}`)}"><span>${esc(label)}</span></button>`;
  };
  const run = runState();
  const routine = (r: RoutineAct) => {
    const on = run?.id === r.id;
    const label = on ? `${r.name} · ${run.step}/${run.of}` : r.name;
    return `<button class="hm-act hm-scene hm-routine${on ? ' busy' : ''}" data-routine="${esc(r.id)}" title="${esc(r.name)}" aria-label="${esc(on ? `Stop the routine ${r.name}` : `Run the routine ${r.name}`)}"><span>${esc(label)}</span></button>`;
  };
  // at most two routines or scenes; a scene with the same name as a routine is skipped (it looked like a duplicate button)
  const routineNames = new Set(routineActs.map(r => r.name));
  const extras = [...routineActs.map(routine), ...sceneActs.filter(s => !routineNames.has(s.name)).map(scene)].slice(0, 2);
  const btn = (a: QuickAction) => `<button class="hm-act${a.kind ? ` ${a.kind}` : ''}" data-act="${a.id}">${a.icon ?? ''}<span>${esc(a.label)}</span></button>`;
  const row = $('hmActs');
  row.innerHTML = ACTIONS.filter(a => !a.end).map(btn).join('') + '<span class="hm-spacer"></span>'
    + extras.join('') + ACTIONS.filter(a => a.end).map(btn).join('');
  fitActs();
}

/** Every label shows whole: while the row is wider than its box, drop the last routine or scene (the Routines app has them all). */
function fitActs(): void {
  const row = $('hmActs');
  if (!row.clientWidth) return;   // not laid out yet; onShow paints again
  let extra = row.querySelectorAll('.hm-scene');
  while (row.scrollWidth > row.clientWidth + 1 && extra.length) {
    extra[extra.length - 1].remove();
    extra = row.querySelectorAll('.hm-scene');
  }
}

// ---------- routines: the first four (the Routines app has them all); a tap runs one, a tap while it runs stops it ----------
interface RoutineAct { id: string; name: string }
let routineActs: RoutineAct[] = [];
async function loadRoutineActs(): Promise<void> {
  let next: RoutineAct[];
  try { next = (await loadRoutines()).slice(0, 4).map(r => ({ id: r.id, name: r.name })); } catch { return; }   // the PC is away: keep them
  if (JSON.stringify(next) === JSON.stringify(routineActs)) return;
  routineActs = next;
  paintActs();
}
function tapRoutine(id: string): void {
  if (runState()?.id === id) { stopRoutine(); return; }
  void startRoutine(id).then(res => {
    if (res === 'started') { act('hop', true); return; }
    if (res === 'gone') { say('That routine is gone.'); void loadRoutineActs(); return; }
    if (res === 'empty') say('That routine has no steps yet.');
    else say('The PC isn’t answering, so that routine can’t start.');
  });
}

async function setScene(id: string): Promise<void> {
  const s = sceneActs.find(x => x.id === id);
  if (!s || sceneBusy.get(id) === 'busy') return;
  sceneBusy.set(id, 'busy');
  paintActs();
  let r: HaResult | null;
  try { r = await postJson<HaResult>('/api/home-assistant/scene', { entity_id: id }); } catch { r = null; }
  sceneBusy.set(id, r?.ok ? 'done' : 'fail');
  paintActs();
  if (r?.ok) act('hop', true);
  else {
    say(sceneFailText(s.name, r));
    if (isOffHome(r)) void loadScenes();
  }
  setTimeout(() => { if (sceneBusy.get(id) !== 'busy') { sceneBusy.delete(id); paintActs(); } }, 2400);
}

/** Ask the Clock app to start a 5-minute timer; if it doesn't pick that up, open the Clock instead. */
function startTimer(): void {
  const before = store.get(CLOCK_TIMERS_KEY);
  dispatchEvent(new CustomEvent('hub:timer', { detail: 5 * 60e3 }));
  const t = timerNow();
  if (store.get(CLOCK_TIMERS_KEY) !== before && t?.end) { act('hop', true); say('5 minutes, go!'); paintClock(); paintStatus(); }
  else openApp('clock');
}

// ---------- ticking ----------
// The clock moves once a minute. A running timer is the only thing that needs seconds, so while one runs and Home is
// on screen the tick comes every second; otherwise it comes on each new minute, on screen or not (the critter's sky).
let lastMinute = -1, tickT: number | undefined;
function tick(): void {
  const d = now(), t = timeParts(d);
  const minute = d.getHours() * 60 + d.getMinutes();
  const fresh = minute !== lastMinute;
  if (fresh) {
    const first = lastMinute < 0;
    lastMinute = minute;
    $('hmDate').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    $('hmTime').innerHTML = `${t.hour}:${t.minute}${t.period ? `<small>${esc(t.period)}</small>` : ''}`;
    setPhase(phaseOf(d.getHours()), !first);
    paintGreeting(d);
    paintLine();
    paintNotes();
    paintCalendar();
  }
  if (fresh || timerNow()?.end) { paintClock(); paintStatus(); }   // the timer's countdown, or a new minute's words
}

function tickDelay(): number {
  const real = Date.now();
  if (ctx.isVisible() && !document.hidden && timerNow()?.end) return 1e3 - real % 1e3 + 20;
  return 60e3 - (real + offset) % 60e3 + 20;   // the next minute, on the clock this app shows
}
function arm(): void {
  clearTimeout(tickT);
  tickT = window.setTimeout(loop, tickDelay());
}
function loop(): void {
  try { tick(); } finally { arm(); }
}

/** "Good evening, Alex" (the name from Settings → Profile, when there is one). Painted each minute and on show. */
function paintGreeting(d: Date): void {
  const name = nickname(), text = `${greeting(d.getHours())}${name ? `, ${name}` : ''}`, el = $('hmGreeting');
  if (el.textContent !== text) el.textContent = text;
}

function refresh(): void {
  void loadUsage();
  void loadWeather();
  void loadScenes();
  void loadRoutineActs();
  void loadCalendar();
  void loadLists();
  paintNotes();
  paintGreeting(now());
  paintActs();   // fit the row again: fonts and the page's width are settled once Home is on screen
  tick();
}

// the live parts, every 30 seconds while Home is on screen only
let pollT: number | undefined;
function poll(): void {
  if (ctx.isVisible() && !document.hidden) { void loadUsage(); void loadWeather(); void loadCalendar(); void loadLists(); }
}
function onShow(): void {
  refresh();
  arm();
  clearInterval(pollT);
  pollT = window.setInterval(poll, 30e3);
  scheduleAct();
}
function onHide(): void {
  clearInterval(pollT); pollT = undefined;
  clearTimeout(actT); actT = undefined;
  clearTimeout(goT); goT = undefined;
  arm();
}

function mount(context: AppContext): void {
  ctx = context;
  drawSky();
  paintActs();
  void document.fonts?.ready.then(() => paintActs());   // the serif's real width decides which routines fit
  $('hmActs').addEventListener('click', e => {
    const sc = (e.target as HTMLElement).closest<HTMLElement>('[data-scene]')?.dataset.scene;
    if (sc) { report('home:scene'); void setScene(sc); return; }
    const rt = (e.target as HTMLElement).closest<HTMLElement>('[data-routine]')?.dataset.routine;
    if (rt) { report('home:routine'); tapRoutine(rt); return; }
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    const a = ACTIONS.find(x => x.id === id);
    if (a) { report(`home:${a.id}`); a.run(); }
  });
  // the glance columns and the two rows under the critter each open their app ([data-go])
  ctx.root.querySelector('.hm-page')!.addEventListener('click', e => {
    const go = (e.target as HTMLElement).closest<HTMLElement>('[data-go]')?.dataset.go;
    if (!go) return;
    report(`home:tile:${go}`);
    if (go === 'notes') { openControlCenter(); return; }
    if (go === 'claude') { const w = waitingSessions()[0]; if (w?.id) { openSession(w.id); return; } }
    if (go === 'claude' && nativeLine()) { openTabletChat(); return; }
    openApp(go);
  });
  $('hmLine').addEventListener('click', () => { if (lineTarget) openSession(lineTarget); });
  $('hmScene').addEventListener('click', onCritterTap);
  onNotificationsChange(paintNotes);
  onResume(() => { if (ctx.isVisible()) refresh(); });

  // the Clock app's timer and alarms: the countdown and the sentence follow at once
  onStore(k => { if (k === CLOCK_TIMERS_KEY || k === CLOCK_TIMER_KEY || k === 'clock.alarms' || k === 'clock.alarm') { paintClock(); paintStatus(); arm(); } });
  tick();
  arm();   // on the minute, even while Home is off screen (it's where the shell drifts back to); onShow takes over
  void loadWeather(true);
  void loadUsage();
  void loadScenes();
  addEventListener('hub:weather', () => { void loadWeather(true); });   // a new place or unit in Weather
  addEventListener('hub:ha-scenes', () => { void loadScenes(); });   // picked in Settings > Apps > Home Assistant
  void loadRoutineActs();
  addEventListener('hub:routines', () => { void loadRoutineActs(); });   // changed in the Routines app
  onRunState(() => paintActs());
  void loadCalendar(true);
  addEventListener('hub:calendar', () => { void loadCalendar(true); });   // the address changed in the Calendar app or Settings
  paintNotes();
}

const app: HubApp = { ...manifest, title: 'Home', icon: HOME, mount, onShow, onHide };
export default app;
