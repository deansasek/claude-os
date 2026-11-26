// The Clock app: a full clock with four tabs (Clock, Timer, Stopwatch, Alarm) and the critter living by the time.
//   Clock      the big serif time, the date, how far the day and week have gone. Tap the time to show seconds.
//   Timer      hour : min : sec dials (drag the numbers or tap / hold the arrows), quick presets, start / pause / ±1 min.
//              Several timers at once: each is a named row under the dial (tap a row to focus it; New timer brings the dial back).
//              An hourglass drains beside the critter. Survives reloads.
//   Stopwatch  start / pause, laps (fastest and slowest marked). The critter jogs while it runs. Survives reloads.
//   Alarm      several alarms, each with on/off and repeat days (or once). Snooze 9 minutes. Saved in local storage,
//              so they keep working across reloads; one that comes due while the page is reloading still rings.
// When a timer finishes or an alarm goes off, Claude Home switches to this app, chimes (gently at first, then louder),
// and the critter hops and waves. A reload while ringing carries on ringing.
// The rail icon is a little clock showing the time; the rail label is the time, or the countdown while a timer runs.
// For testing, ?hour=23 (and &min=59) shifts this app's clock.
import { esc, onStore, params, report, store } from '../../../core/web/dom.ts';
import { clockIcon } from '../../../core/web/app-icons.ts';
import { INK, inkSay, inkedBlob, inkedShape, rng } from '../../../core/web/ink.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { provideClock, type ClockApi } from '../../../core/web/voice-commands.ts';
import { manifest } from '../manifest.ts';
import { registerAppSettings } from '../../../core/web/app-settings.ts';
import { alertFor, critterSpeak, onBack, openApp } from '../../../core/web/system.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import { dur, lengthWords, words } from './timer-text.ts';
import { CLOCK_TIMERS_KEY, CLOCK_TIMER_KEY, nextTimerName, parseClockTimers, runningLeftMs, type ClockTimer } from '../../../core/web/clock-timer.ts';

type Mode = 'clock' | 'timer' | 'stopwatch' | 'alarm';
type View = Mode | 'edit' | 'ring';
type Phase = 'morning' | 'day' | 'evening' | 'night';
type Act = 'hop' | 'stretch' | 'wave';

const ACT_MS: Record<Act, number> = { hop: 800, stretch: 2200, wave: 2400 };
const TIMER_PRESETS = [1, 3, 5, 10, 15, 30];   // minutes; anything else is dialled in above
const ALARM_PRESETS: [number, number][] = [[6, 0], [6, 30], [7, 0], [7, 30], [8, 0], [9, 0]];
const K = {
  mode: 'clock.mode', secs: 'clock.seconds', timers: CLOCK_TIMERS_KEY, timer: CLOCK_TIMER_KEY, draft: 'clock.timerDraft', sw: 'clock.stopwatch',
  alarms: 'clock.alarms', legacyAlarm: 'clock.alarm', ring: 'clock.ring', secHint: 'clock.hint.seconds',
};
const SNOOZE_MS = 9 * 60e3;
const RING_LIMIT = { timer: 2 * 60e3, alarm: 3 * 60e3 };
const MAX_ALARMS = 20;   // the list scrolls; Claude's reminders are alarms too
const MAX_TIMERS = 20;   // the same total as MAX_ACTIVE in claude's browser-relay.ts; the list scrolls
const WEEK = [1, 2, 3, 4, 5, 6, 0];   // shown Monday first; values are Date.getDay()

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const pad = (n: number) => String(n).padStart(2, '0');
const readJson = <T>(k: string): T | null => { try { return JSON.parse(store.get(k) || 'null') as T; } catch { return null; } };

let mode: Mode = (['clock', 'timer', 'stopwatch', 'alarm'] as Mode[]).find(m => m === store.get(K.mode)) || 'clock';
let showSeconds = store.get(K.secs) === '1';

// ---------- the time (with an optional test offset) ----------
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
const H12 = !!timeParts(new Date(2000, 0, 1, 13)).period;
const PERIODS = H12 ? [timeParts(new Date(2000, 0, 1, 9)).period, timeParts(new Date(2000, 0, 1, 21)).period] : ['', ''];
const hm = (d: Date): string => { const t = timeParts(d); return `${t.hour}:${t.minute}${t.period ? ' ' + t.period : ''}`; };
const hourWord = (d: Date): string => timeParts(d).hour.replace(/^0/, '');
/** An alarm's own clock face: "7:00" + "AM" (or "07:00" in 24-hour places). */
function alarmParts(h: number, m: number): { hm: string; period: string } {
  const t = timeParts(new Date(2000, 0, 1, h, m));
  return { hm: `${t.hour}:${t.minute}`, period: t.period };
}
const alarmText = (h: number, m: number) => { const p = alarmParts(h, m); return p.period ? `${p.hm} ${p.period}` : p.hm; };
const dayName = (day: number, style: 'short' | 'long' = 'short') =>
  new Date(2000, 0, 2 + day).toLocaleDateString([], { weekday: style });   // 2 Jan 2000 was a Sunday


// ---------- icons ----------
const rad = (deg: number) => (deg - 90) * Math.PI / 180;
const at = (cx: number, cy: number, deg: number, r: number) => [(cx + r * Math.cos(rad(deg))).toFixed(2), (cy + r * Math.sin(rad(deg))).toFixed(2)];
/** The rail icon: the shared hand-drawn clock face (core/web/app-icons.ts), its hands at time d. */
const railIcon = (d: Date = now()): string => clockIcon(d);
const CHEV = (up: boolean) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${up ? 'M6 14.5l6-6 6 6' : 'M6 9.5l6 6 6-6'}"/></svg>`;

// ---------- touch controls: hold-to-repeat arrows and scrubbable numbers ----------
function holdRepeat(b: HTMLElement, fn: () => void): void {
  let t: number | undefined, n = 0;
  const stop = () => { clearTimeout(t); t = undefined; b.classList.remove('held'); };
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    unlockAudio(); stop(); n = 0; fn(); b.classList.add('held');
    const again = () => { n++; fn(); t = window.setTimeout(again, n > 14 ? 45 : n > 5 ? 80 : 140); };
    t = window.setTimeout(again, 450);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
  b.addEventListener('contextmenu', e => e.preventDefault());
}
/** Drag a number up or down to change it, one step every ~20px. */
function scrub(el: HTMLElement, fn: (d: number) => void): void {
  let y0 = 0, done = 0, id: number | null = null;
  el.addEventListener('pointerdown', e => {
    id = e.pointerId; y0 = e.clientY; done = 0;
    try { el.setPointerCapture(e.pointerId); } catch { /* fine */ }
    el.classList.add('scrub');
  });
  el.addEventListener('pointermove', e => {
    if (id !== e.pointerId) return;
    const steps = Math.trunc((y0 - e.clientY) / 20);
    while (done < steps) { done++; fn(1); }
    while (done > steps) { done--; fn(-1); }
  });
  const end = () => { id = null; el.classList.remove('scrub'); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
/** One dial column: ▲, the number (drag it), a unit label, ▼. */
function spinner(unit: string, label: string, onStep: (d: number) => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ck-spin'; el.dataset.unit = unit;
  el.innerHTML = `<button class="ck-chev hit" data-d="1" aria-label="More ${label}">${CHEV(true)}</button>`
    + `<div class="ck-digit num">00</div><span class="ck-unit">${label}</span>`
    + `<button class="ck-chev hit" data-d="-1" aria-label="Less ${label}">${CHEV(false)}</button>`;
  el.querySelectorAll<HTMLElement>('.ck-chev').forEach(b => holdRepeat(b, () => onStep(+b.dataset.d!)));
  scrub(el.querySelector<HTMLElement>('.ck-digit')!, onStep);
  el.addEventListener('wheel', e => { e.preventDefault(); onStep(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  return el;
}
const sep = () => Object.assign(document.createElement('div'), { className: 'ck-colon', textContent: ':' });
const setDigit = (box: HTMLElement, unit: string, text: string, dim = false) => {
  const s = box.querySelector<HTMLElement>(`.ck-spin[data-unit="${unit}"]`)!;
  s.querySelector('.ck-digit')!.textContent = text;
  s.classList.toggle('dim', dim);
};

// ---------- the critter ----------
let phase: Phase | null = null;
let acting = false;
let wokeTimer: number | undefined;
let tapCount = 0;

const phaseOf = (h: number): Phase => (h >= 22 || h < 6 ? 'night' : h < 10 ? 'morning' : h < 18 ? 'day' : 'evening');
const say = (text: string, tail: 'left' | 'right' = 'right'): void => inkSay($('ckSay'), text, tail);

function act(name: Act, force = false): void {
  if (acting && !force) return;
  (Object.keys(ACT_MS) as Act[]).forEach(n => ctx.root.classList.remove(`ck-act-${n}`));
  void ctx.root.offsetWidth;
  acting = true;
  ctx.root.classList.add(`ck-act-${name}`);
  setTimeout(() => { ctx.root.classList.remove(`ck-act-${name}`); acting = false; }, ACT_MS[name]);
}

function wake(ms = 3500): void {
  ctx.root.classList.add('ck-woke');
  clearTimeout(wokeTimer);
  wokeTimer = window.setTimeout(() => ctx.root.classList.remove('ck-woke'), ms);
}

/** The sun and a cloud, drawn by hand like the weather icons: warm blobs with an ink outline. */
function drawSky(): void {
  const rnd = rng(7), cx = 24.8, cy = 4.2;
  const b = inkedBlob(cx, cy, 1.9, 1.85, rnd, 8, .05, [.06, .05], .05);
  let rays = '';
  for (let i = 0; i < 8; i++) {
    const a = i * 45 + rnd() * 8, [x1, y1] = at(cx, cy, a, 2.6), [x2, y2] = at(cx, cy, a, 3.3 + rnd() * .3);
    rays += `<path d="M${x1} ${y1}L${x2} ${y2}"/>`;
  }
  $('ckSun').innerHTML = `<g class="ck-rays" stroke="${INK}" stroke-width=".14" stroke-linecap="round">${rays}</g>`
    + `<path d="${b.fill}" fill="var(--clay)" opacity=".9"/><path class="ck-ink" d="${b.line}" fill="none" stroke="${INK}" stroke-width=".13" stroke-linecap="round"/>`;
  // a little cumulus: flat underneath, three bumps on top
  const c = inkedShape([[6.5, 5.25], [6.35, 4.6], [6.9, 4.05], [7.7, 4.0], [8.2, 3.25], [9.1, 2.85], [10.0, 3.2], [10.4, 3.85],
    [11.1, 3.9], [11.75, 4.5], [11.6, 5.2], [9.1, 5.4]], [9.1, 4.3], [.07, .05], .05);
  $('ckCloud').innerHTML = `<path d="${c.fill}" fill="var(--cloud)"/><path d="${c.line}" fill="none" stroke="var(--text)" stroke-width=".11" stroke-linecap="round"/>`;
}

function setPhase(p: Phase, announce: boolean): void {
  if (p === phase) return;
  const first = phase === null;
  phase = p;
  ctx.root.classList.remove('ck-morning', 'ck-day', 'ck-evening', 'ck-night');
  ctx.root.classList.add(`ck-${p}`);
  if (!first && announce && !ringing) {
    if (p === 'morning') { act('stretch', true); say('*yawn*… morning!'); }
    else if (p === 'evening') say('tea time');
    else if (p === 'night') say('night night…');
  }
}

// the idle acts: only while the Clock is on screen (onShow starts them, onHide stops them)
let actT: number | undefined;
function scheduleAct(): void {
  clearTimeout(actT);
  actT = undefined;
  if (!ctx.isVisible()) return;
  actT = window.setTimeout(() => {
    if (phase && phase !== 'night' && !document.hidden && !ringing && !sw.running) {
      act(phase === 'morning' ? pick<Act>(['stretch', 'hop']) : pick<Act>(['hop', 'wave', 'stretch', 'hop']));
    }
    scheduleAct();
  }, 7000 + Math.random() * 6000);
}

function tapLine(d: Date): string {
  if (ringing) return 'tap Stop!';
  const soon = soonestLeft();
  if (soon != null) return pick([`${dur(soon)} to go`, 'watching the sand…', 'not long now']);
  if (sw.running) return pick(['go go go!', 'huff… puff…', 'one more lap!']);
  const h = d.getHours(), m = d.getMinutes();
  if (m >= 50 && h !== 23 && Math.random() < .5) return `almost ${hourWord(new Date(d.getTime() + (60 - m) * 60e3))} o’clock!`;
  const lines =
    h >= 22 || h < 5 ? ['past bedtime…', 'shh… sleeping', 'zzz… oh, hi'] :
    h < 8 ? ['so early!', 'coffee first…', '*yawn*'] :
    h < 11 ? ['good morning!', 'big day ahead', 'rise and shine'] :
    h < 12 ? ['almost lunch!', 'is it lunch yet?'] :
    h < 13 ? ['lunchtime!', "snack o’clock"] :
    h < 17 ? ['afternoon already', 'tick tock!', 'keep going!'] :
    h < 19 ? ['almost dinner', 'nearly done for today'] : ['cozy evening', 'tea time', 'time to unwind'];
  return lines[tapCount++ % lines.length];
}

function onCritterTap(): void {
  report('clock:critter');
  unlockAudio();
  if (phase === 'night') wake();
  act('hop', true);
  const line = tapLine(now());
  say(line);
  critterSpeak(line);
}

// ---------- sound: a soft bell-like arpeggio that grows louder the longer it rings ----------
let audio: AudioContext | null = null;
function unlockAudio(): void {
  try {
    if (!audio) audio = new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch { /* no audio here */ }
}
/** level 0 → a quiet two-note chime; level 1 → a fuller, louder three-note phrase played twice. */
function chime(level: number): void {
  if (!audio) unlockAudio();
  if (!audio) return;
  const a = audio, t0 = a.currentTime + .02, peak = .05 + .25 * level;
  const notes: [number, number][] = level < .3 ? [[880, 0], [1318.5, .2]]
    : level < .7 ? [[880, 0], [1108.7, .18], [1318.5, .36]]
    : [[880, 0], [1108.7, .16], [1318.5, .32], [880, .7], [1108.7, .86], [1318.5, 1.02]];
  for (const [f, dt] of notes) {
    for (const [mult, share, type] of [[1, 1, 'sine'], [2, .18, 'sine'], [.5, .25 * level, 'triangle']] as [number, number, OscillatorType][]) {
      if (share <= 0) continue;
      const o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.value = f * mult;
      g.gain.setValueAtTime(0, t0 + dt);
      g.gain.linearRampToValueAtTime(peak * share, t0 + dt + .015);
      g.gain.exponentialRampToValueAtTime(.0008, t0 + dt + .9);
      o.connect(g).connect(a.destination);
      o.start(t0 + dt); o.stop(t0 + dt + .95);
    }
  }
}

// ---------- ringing (shared by the timer and the alarm) ----------
interface RingState { kind: 'timer' | 'alarm'; id: string | null; started: number; title: string; big: string; sub: string }
let ringing: RingState | null = null;
let ringFrom: Mode = 'clock';
let ringLoop: number | undefined;

function ring(r: RingState, fresh = true): void {
  if (!ringing) ringFrom = mode;
  editing = null;
  ringing = r;
  store.set(K.ring, JSON.stringify(r));
  $('ckRingTitle').textContent = r.title;
  $('ckRingBig').innerHTML = esc(r.big).replace(/ (\S+)$/, '<small>$1</small>');   // "7:00 AM" → 7:00 with a small AM
  $('ckRingSnooze').textContent = r.kind === 'alarm' ? 'Snooze 9 min' : 'Add 1 min';
  const a = r.kind === 'alarm' ? alarms.find(x => x.id === r.id) : null;
  const label = labelOf(a);
  const sub = label ? `${label} · ${r.sub}` : r.sub;   // the label leads the line under the time (r itself is stored as it was)
  $('ckRingSub').textContent = sub;
  $('ckRingNote').textContent = r.kind === 'alarm'
    ? (a && a.days.length ? `Stop quiets it until ${a.days.length === 7 ? 'tomorrow' : 'its next day'}. Snooze rings again in 9 minutes.` : 'Stop turns it off. Snooze rings again in 9 minutes.')
    : 'Stop to finish, or Add 1 min for a little longer.';
  ctx.root.classList.add('ck-ringing', 'ck-woke');
  renderView();
  ctx.requestAttention();
  if (fresh) alertFor('timer', { title: r.kind === 'alarm' ? `Alarm · ${r.big}${label ? ` · ${label}` : ''}` : 'Time’s up', body: sub, app: 'clock' }, undefined, ctx.isVisible());
  ctx.setBadge(true);
  say(r.kind === 'alarm' ? 'wake up! wake up!' : 'time’s up!');
  clearTimeout(ringLoop);
  const loop = () => {
    if (!ringing) return;
    const el = Date.now() - ringing.started;
    if (el > RING_LIMIT[ringing.kind]) { stopRing(true); return; }
    const level = Math.min(1, el / 45e3);
    chime(level);
    if (Math.random() < .3) say(pick(['ding ding!', 'hey! hey!', 'over here!']));
    ringLoop = window.setTimeout(loop, 3400 - 1600 * level);
  };
  loop();
  renderRingFor();
  renderStatus();
}

function renderRingFor(): void {
  if (!ringing) return;
  const el = Date.now() - ringing.started;
  $('ckRingFor').textContent = `ringing ${dur(el, false)}`;
  $('ckRingKick').textContent = el > 30e3 ? '· getting louder' : '· starting softly';
}

function stopRing(gaveUp = false): void {
  if (!ringing) return;
  const r = ringing;
  ringing = null;
  store.set(K.ring, null);
  clearTimeout(ringLoop);
  ctx.root.classList.remove('ck-ringing', 'ck-woke');
  ctx.setBadge(false);
  const lbl = labelOf(r.kind === 'alarm' ? alarms.find(x => x.id === r.id) : null);
  if (gaveUp) alertFor('timer', { title: r.kind === 'alarm' ? `Missed alarm · ${r.big}${lbl ? ` · ${lbl}` : ''}` : 'Timer finished', body: lbl ? `${lbl} · ${r.sub}` : r.sub, app: 'clock' }, undefined, ctx.isVisible());
  setMode(ringFrom);
  act('wave', true);
  say(gaveUp ? 'nobody came…' : 'all done!');
}

// ---------- timers: a list, each with a name ----------
// `timer` is the focused one: a timer in the list (running or paused), or the draft that the dial sets (not listed).
// Start on the draft adds a timer to the list; Start on a paused timer resumes it; a preset adds a timer at once.
// The list is kept under clock.timers, which the other screens read (core/web/clock-timer.ts).
const DRAFT_DUR = 5 * 60e3;
const draftOf = (dur: number): ClockTimer => ({ id: '', name: '', dur, end: null, left: null });
const savedDraft = (): number => { const n = Number(store.get(K.draft)); return n >= 1e3 ? n : DRAFT_DUR; };
const loaded = parseClockTimers(store.get(K.timers), store.get(K.timer));
let timers: ClockTimer[] = loaded.timers;
if (loaded.migrate) { store.set(K.timers, JSON.stringify(timers)); store.set(K.timer, null); }   // the first read saves the list
if (loaded.draft != null) store.set(K.draft, String(loaded.draft));   // an idle earlier timer keeps its length on the dial
let timer: ClockTimer = timers.find(t => t.end) ?? timers[0] ?? draftOf(savedDraft());
const saveTimers = () => store.set(K.timers, JSON.stringify(timers));
const saveDraft = () => store.set(K.draft, String(timer.dur));
const isListed = (t: ClockTimer): boolean => timers.includes(t);
const timerLeft = (): number => (timer.end ? timer.end - Date.now() : timer.left ?? timer.dur);
const anyRunning = (): boolean => timers.some(t => t.end);
/** The soonest running timer's time left, or null when none runs. */
const soonestLeft = (): number | null => runningLeftMs(timers, Date.now());
/** The timer a voice or drawer action acts on when none is named: the soonest running listed timer, else a paused one, else the focused timer. */
const actionTimer = (): ClockTimer => timers.filter(t => t.end).reduce<ClockTimer | null>((best, t) => (!best || t.end! < best.end!) ? t : best, null) ?? timers.find(t => t.left != null) ?? timer;
/** Focus the timer that actionTimer picks, so the timer controls and the dial show it. */
const focusAction = (): void => { timer = actionTimer(); };

function timerStart(ms?: number, name?: string): void {
  unlockAudio();
  if (ms) { addTimer(ms, name); return; }
  if (timer.end || (timer.left == null && timer.dur < 1e3)) return;
  if (!isListed(timer)) { addTimer(timer.dur); return; }
  timer.end = Date.now() + (timer.left ?? timer.dur);
  timer.left = null;
  saveTimers();
  act('hop', true); say(pick(['on it!', 'tick tock…', `${dur(timer.end - Date.now())}, go!`]));
  renderTimer();
}
/** A new timer in the list, running and in front. It gets the given name, or "Timer" and its number. */
function addTimer(ms: number, name?: string): void {
  if (timers.length >= MAX_TIMERS) { say('The list is full. Stop a timer first.'); return; }
  const t: ClockTimer = { id: newId(), name: name || nextTimerName(timers), dur: ms, end: Date.now() + ms, left: null };
  timers.push(t);
  timer = t;
  saveTimers();
  act('hop', true); say(pick(['on it!', 'tick tock…', `${dur(ms)}, go!`]));
  renderTimer();
}
function timerPause(): void { if (!timer.end) return; timer.left = timer.end - Date.now(); timer.end = null; saveTimers(); renderTimer(); }
/** Cancel the focused timer: a listed one leaves the list; the draft keeps its length. */
function timerReset(): void {
  const len = timer.dur;
  if (isListed(timer)) timers = timers.filter(t => t !== timer);
  timer = draftOf(len);
  saveTimers(); saveDraft(); renderTimer();
}
/** The dial sets a new timer: the draft comes in front; the timers in the list keep running. */
function newTimer(): void { timer = draftOf(timer.dur); saveDraft(); renderTimer(); }
function timerNudge(sign: 1 | -1): void {
  const step = 60e3;
  if (timer.end) timer.end = Math.max(Date.now() + 5e3, timer.end + sign * step);
  else if (timer.left != null) timer.left = Math.max(5e3, timer.left + sign * step);
  timer.dur = Math.max(timer.dur, timerLeft());   // keep the progress bar and the sand honest
  saveTimers(); renderTimer();
}
/** Turn one dial of the idle timer: hours wrap 0–23, minutes 0–59, seconds in fives. */
function timerDial(unit: 'h' | 'm' | 's', d: number): void {
  const s = Math.round(timer.dur / 1e3);
  let h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  if (unit === 'h') h = (h + d + 24) % 24;
  else if (unit === 'm') m = (m + d + 60) % 60;
  else sec = ((Math.round(sec / 5) * 5 + d * 5) % 60 + 60) % 60;
  timer.dur = (h * 3600 + m * 60 + sec) * 1e3;
  saveDraft(); renderTimer();
}

function renderTimer(): void {
  const left = timerLeft(), running = !!timer.end, paused = !running && timer.left != null, setting = !running && !paused;
  ctx.root.classList.toggle('ck-tset', setting);
  const big = $('ckTimer');
  big.textContent = dur(left);
  big.classList.toggle('long', left >= 3600e3);
  big.classList.toggle('idle', paused);
  $('ckTimerProg').style.width = `${(1 - Math.max(0, Math.min(1, left / (timer.dur || 1)))) * 100}%`;
  $('ckTimerState').textContent = running ? 'Running' : paused ? 'Paused' : '';
  $('ckTimerSub').textContent = running ? `${isListed(timer) ? `${timer.name} · ` : ''}Done at ${hm(new Date(Date.now() + offset + left))} · a ${lengthWords(timer.dur)} timer`
    : paused ? `${timer.name} · paused with ${dur(left)} left. Resume to carry on.` : '';
  const s = Math.round(timer.dur / 1e3), set = $('ckTimerSet');
  setDigit(set, 'h', pad(Math.floor(s / 3600)), s < 3600);
  setDigit(set, 'm', pad(Math.floor(s / 60) % 60));
  setDigit(set, 's', pad(s % 60));
  $('ckTimerHint').textContent = setting ? (timer.dur ? `drag the numbers · done at ${hm(new Date(Date.now() + offset + timer.dur))}` : 'drag the numbers or tap the arrows') : '';
  const full = timers.length >= MAX_TIMERS;
  const go = $<HTMLButtonElement>('ckTimerGo');
  go.textContent = running ? 'Pause' : paused ? 'Resume' : 'Start';
  go.classList.toggle('pause', running);
  go.disabled = setting && (timer.dur < 1e3 || full);
  ctx.root.classList.toggle('ck-timing', running);
  ctx.root.style.setProperty('--sand', String(Math.max(0, Math.min(1, left / (timer.dur || 1)))));
  $('ckPresets').querySelectorAll<HTMLButtonElement>('.ck-chip').forEach(c => { c.classList.toggle('on', +c.dataset.min! * 60e3 === timer.dur); c.disabled = full; });
  tabDot('timer', timers.length > 0);
  renderTimerList();
  renderStatus();
}

// The list under the dial: one row per timer (name, countdown, state). A tap focuses that timer. It is rebuilt only when
// the timers or the focus change, so a tap is not lost to the once-a-second countdown, which only rewrites the times.
let listKey = '';
function renderTimerList(): void {
  const box = $('ckTimerList');
  const key = `${timers.map(t => `${t.id}${t.end ? 'r' : 'p'}`).join(',')}|${timers.indexOf(timer)}`;
  if (key !== listKey) {
    listKey = key;
    box.innerHTML = timers.map((t, i) => `<button type="button" class="ck-trow${t === timer ? ' on' : ''}" data-i="${i}">`
      + `<span class="ck-tname">${esc(t.name)}</span><span class="ck-tleft num"></span><span class="ck-tstate">${t.end ? 'Running' : 'Paused'}</span></button>`).join('')
      + (timers.length ? '<button type="button" class="ck-trow new" data-new="1">New timer</button>' : '');
  }
  const now = Date.now();
  box.querySelectorAll<HTMLElement>('.ck-trow[data-i]').forEach(b => {
    const t = timers[+b.dataset.i!];
    if (t) b.querySelector<HTMLElement>('.ck-tleft')!.textContent = dur(t.end ? t.end - now : t.left ?? t.dur);
  });
}

// ---------- stopwatch ----------
interface SwState { running: boolean; start: number; acc: number; laps: number[] }   // laps: split times (ms since start)
const sw: SwState = { running: false, start: 0, acc: 0, laps: [], ...readJson<SwState>(K.sw) };
const saveSw = () => store.set(K.sw, JSON.stringify(sw));
let swFrame: number | undefined;
const swTime = (): number => sw.acc + (sw.running ? Date.now() - sw.start : 0);
const tenths = (ms: number) => `${dur(ms, false)}.${Math.floor(ms / 100) % 10}`;

function swToggle(): void {
  if (sw.running) { sw.acc = swTime(); sw.running = false; }
  else { sw.start = Date.now(); sw.running = true; act('hop', true); say(pick(['and… go!', "let’s go!", 'ready, set…'])); }
  saveSw(); renderSw(); renderLaps();
}
function swLap(): void {
  if (!sw.running) return;
  sw.laps.push(swTime());
  saveSw();
  say(`lap ${sw.laps.length}!`);
  renderSw(); renderLaps();
}
function swReset(): void { sw.running = false; sw.acc = 0; sw.laps = []; saveSw(); renderSw(); renderLaps(); }

function renderSw(): void {
  const t = swTime(), big = $('ckSw');
  big.innerHTML = `${dur(t, false)}<small>.${Math.floor(t / 100) % 10}</small>`;
  big.classList.toggle('long', t >= 3600e3);
  big.classList.toggle('idle', !sw.running && t > 0);
  $('ckSwState').textContent = sw.running ? 'Running' : t ? 'Paused' : '';
  const lapNow = t - (sw.laps[sw.laps.length - 1] || 0);
  $('ckSwSub').textContent = sw.running ? (sw.laps.length ? `Lap ${sw.laps.length + 1} · ${dur(lapNow, false)} so far` : 'Tap Lap to mark a split.')
    : t ? 'Paused. Resume carries on, Reset clears it.' : 'Tap Start. Laps show up below.';
  const live = ctx.root.querySelector('#ckLapLive b');
  if (live) live.textContent = tenths(lapNow);
  const go = $('ckSwGo');
  go.textContent = sw.running ? 'Pause' : t ? 'Resume' : 'Start';
  go.classList.toggle('pause', sw.running);
  $<HTMLButtonElement>('ckSwLap').disabled = !sw.running;
  $<HTMLButtonElement>('ckSwReset').disabled = sw.running || !t;
  ctx.root.classList.toggle('ck-running', sw.running);
  tabDot('stopwatch', sw.running || t > 0);
  renderStatus();
  clearTimeout(swFrame);
  if (sw.running && mode === 'stopwatch' && ctx.isVisible()) swFrame = window.setTimeout(renderSw, 100);
}
function renderLaps(): void {
  const box = $('ckLaps'), t = swTime();
  $('ckLapCount').textContent = sw.laps.length ? `· ${sw.laps.length} lap${sw.laps.length > 1 ? 's' : ''}` : '';
  if (!sw.laps.length && !sw.running) { box.innerHTML = '<div class="ck-empty">No laps yet. Start, then tap Lap.</div>'; return; }
  const splits = sw.laps.map((x, i) => x - (sw.laps[i - 1] || 0));
  const best = splits.length > 1 ? Math.min(...splits) : -1, worst = splits.length > 1 ? Math.max(...splits) : -1;
  // the lap in progress first, then newest first; nine fit (three columns of three)
  const rows: string[] = [];
  if (sw.running || t > (sw.laps[sw.laps.length - 1] || 0)) {
    rows.push(`<div class="ck-lap ck-cur" id="ckLapLive"><span>Lap ${sw.laps.length + 1}</span><b class="num">${tenths(t - (sw.laps[sw.laps.length - 1] || 0))}</b><em>${sw.running ? 'now' : 'paused'}</em></div>`);
  }
  splits.map((s, i) => ({ s, i })).reverse().slice(0, 9 - rows.length).forEach(({ s, i }) => {
    const tag = s === best ? '<em class="best">fastest</em>' : s === worst ? '<em class="worst">slowest</em>' : `<em>at ${dur(sw.laps[i], false)}</em>`;
    rows.push(`<div class="ck-lap${s === best ? ' best' : s === worst ? ' worst' : ''}"><span>Lap ${i + 1}</span><b class="num">${tenths(s)}</b>${tag}</div>`);
  });
  box.innerHTML = rows.join('');
}

// ---------- alarms ----------
// claude: set by Claude (set_alarm, set_reminder); once it has rung it may make room for a new one
interface Alarm { id: string; h: number; m: number; on: boolean; days: number[]; snooze: number | null; fired: string | null; label?: string; claude?: true }
const LABEL_MAX = 80;   // a reminder's text is its label
const labelOf = (a: { label?: unknown } | null | undefined): string => (typeof a?.label === 'string' ? a.label.trim() : '');
const newId = () => Math.random().toString(36).slice(2, 9);
function loadAlarms(): Alarm[] {
  const list = readJson<Alarm[]>(K.alarms);
  if (Array.isArray(list)) {
    return list.filter(a => a && typeof a.h === 'number' && typeof a.m === 'number')
      .map(a => {
        const label = labelOf(a).slice(0, LABEL_MAX);   // old alarms have no label; the field is optional
        return { id: a.id || newId(), h: a.h, m: a.m, on: !!a.on, days: Array.isArray(a.days) ? a.days : [], snooze: a.snooze ?? null, fired: a.fired ?? null,
          ...(label ? { label } : {}), ...(a.claude === true ? { claude: true as const } : {}) };
      });
  }
  // the old single daily alarm becomes the first of the list
  const old = readJson<{ h: number; m: number; on: boolean; snooze: number | null; firedKey: string | null }>(K.legacyAlarm);
  if (old && typeof old.h === 'number') {
    return [{ id: newId(), h: old.h, m: old.m, on: !!old.on, days: [0, 1, 2, 3, 4, 5, 6], snooze: old.snooze ?? null, fired: null }];
  }
  return [];
}
let alarms: Alarm[] = loadAlarms();
function saveAlarms(): void {
  alarms.sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));
  store.set(K.alarms, JSON.stringify(alarms));
}
saveAlarms();

const dayOk = (a: Alarm, d: Date) => !a.days.length || a.days.includes(d.getDay());
const occKey = (a: Alarm, t: Date) => `${t.toDateString()} ${a.h}:${a.m}`;
/** Don't let an alarm set for a minute that has just passed ring straight away. */
function arm(a: Alarm, d: Date = now()): void {
  const t = new Date(d); t.setHours(a.h, a.m, 0, 0);
  a.fired = t.getTime() <= d.getTime() ? occKey(a, t) : null;
}
/** When it next rings, as a timestamp in "app time" (null when off). */
function nextFire(a: Alarm, d: Date = now()): number | null {
  if (a.snooze) return a.snooze + offset;
  if (!a.on) return null;
  for (let k = 0; k < 8; k++) {
    const t = new Date(d); t.setDate(d.getDate() + k); t.setHours(a.h, a.m, 0, 0);
    if (t.getTime() > d.getTime() && dayOk(a, t)) return t.getTime();
  }
  return null;
}
function nextAlarm(d: Date = now()): { a: Alarm; at: number } | null {
  let best: { a: Alarm; at: number } | null = null;
  for (const a of alarms) { const t = nextFire(a, d); if (t != null && (!best || t < best.at)) best = { a, at: t }; }
  return best;
}
function repeatLabel(days: number[]): string {
  const s = [...days].sort();
  if (!s.length) return 'Once';
  if (s.length === 7) return 'Every day';
  if (s.join() === '1,2,3,4,5') return 'Weekdays';
  if (s.join() === '0,6') return 'Weekends';
  // runs of three or more days read as a range: "Mon–Thu, Sat"
  const order = WEEK.filter(d => s.includes(d)), parts: string[] = [];
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && WEEK.indexOf(order[j + 1]) === WEEK.indexOf(order[j]) + 1) j++;
    parts.push(j - i >= 2 ? `${dayName(order[i])}–${dayName(order[j])}` : order.slice(i, j + 1).map(d => dayName(d)).join(', '));
    i = j + 1;
  }
  return parts.join(', ');
}
/** "today", "tomorrow", or "Tue" for when an alarm next rings */
function whenWord(t: number, d: Date = now()): string {
  const a = new Date(t), today = new Date(d); today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(a).setHours(0, 0, 0, 0) - today.getTime()) / 864e5);
  return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : dayName(a.getDay(), 'long');
}

function alarmToggle(id: string): void {
  const a = alarms.find(x => x.id === id);
  if (!a) return;
  unlockAudio();
  a.on = !(a.on || a.snooze); a.snooze = null;
  if (a.on) arm(a);
  saveAlarms(); renderAlarms();
  if (a.on) { act('hop', true); say(`see you at ${alarmParts(a.h, a.m).hm}!`); }
}
function quickAdd(h: number, m: number): void {
  unlockAudio();
  let a = alarms.find(x => x.h === h && x.m === m);
  if (!a) {
    if (alarms.length >= MAX_ALARMS) { say('that’s the most alarms I can keep.'); return; }
    a = { id: newId(), h, m, on: true, days: [0, 1, 2, 3, 4, 5, 6], snooze: null, fired: null };
    alarms.push(a);
  }
  a.on = true; a.snooze = null; arm(a);
  saveAlarms(); renderAlarms();
  act('hop', true); say(`see you at ${alarmParts(h, m).hm}!`);
}

function renderAlarms(): void {
  const d = now(), list = $('ckAlList');
  const onCount = alarms.filter(a => a.on || a.snooze).length;
  $('ckAlarmState').textContent = alarms.length ? (onCount ? `${onCount} on` : 'All off') : '';
  $('ckAlHint').textContent = alarms.length ? 'tap an alarm to change it' : '';   // rows open the editor; nothing else says so
  $<HTMLButtonElement>('ckAlAdd').disabled = alarms.length >= MAX_ALARMS;
  if (!alarms.length) {
    list.innerHTML = '<div class="ck-aempty"><em>No alarms yet.</em><span>Tap New alarm, or pick a time below.</span></div>';
  } else {
    list.innerHTML = alarms.map(a => {
      const p = alarmParts(a.h, a.m), next = nextFire(a, d);
      const state = a.snooze ? `Snoozed · rings in ${words(a.snooze + offset - d.getTime())}`
        : next != null ? `Rings ${whenWord(next, d)} · in ${words(next - d.getTime())}` : 'Off';
      const label = labelOf(a), rep = repeatLabel(a.days);
      // with a label, the label is the row's name and the repeat moves onto the detail line
      const head = label ? esc(label) : rep, detail = label ? `${rep} · ${state}` : state;
      return `<div class="ck-arow${a.on || a.snooze ? ' on' : ''}" data-id="${a.id}">`
        + `<div class="ck-atime num">${p.hm}${p.period ? `<small>${p.period}</small>` : ''}</div>`
        + `<div class="ck-ainfo"><b>${head}</b><span>${detail}</span></div>`
        + `<button class="ck-switch hit${a.on || a.snooze ? ' on' : ''}" data-toggle="${a.id}" role="switch" aria-checked="${!!(a.on || a.snooze)}" aria-label="Alarm ${alarmText(a.h, a.m)}"><i></i></button></div>`;
    }).join('');
  }
  $('ckAlarmPresets').querySelectorAll<HTMLElement>('.ck-chip').forEach(c =>
    c.classList.toggle('on', alarms.some(a => a.on && a.h === +c.dataset.h! && a.m === +c.dataset.m!)));
  tabDot('alarm', onCount > 0);
  renderNextPill();
  renderStatus();
}

function renderNextPill(): void {
  const n = nextAlarm(), pill = $('ckNext');
  pill.hidden = !n;
  if (n) {
    const soon = n.at - now().getTime() < 20 * 3600e3;
    $('ckNextText').textContent = `${hm(new Date(n.at))}${soon ? '' : ` ${dayName(new Date(n.at).getDay())}`}`;
  }
}

function checkAlarms(d: Date): void {
  if (ringing) return;
  for (const a of alarms) {
    if (a.snooze) {
      if (Date.now() < a.snooze) continue;
      a.snooze = null;
    } else {
      if (!a.on) continue;
      const t = new Date(d); t.setHours(a.h, a.m, 0, 0);
      const late = d.getTime() - t.getTime();
      // up to three minutes late still rings: the page may have been reloading at the time
      if (late < 0 || late > 3 * 60e3 || !dayOk(a, t) || a.fired === occKey(a, t)) continue;
      a.fired = occKey(a, t);
      if (!a.days.length) a.on = false;    // a one-off alarm turns itself off once it rings
    }
    saveAlarms(); renderAlarms();
    ring({ kind: 'alarm', id: a.id, started: Date.now(), title: 'Alarm', big: alarmText(a.h, a.m),
      sub: `${d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · ${repeatLabel(a.days)}` });
    return;
  }
}

function snooze(): void {
  if (!ringing) return;
  const a = alarms.find(x => x.id === ringing!.id);
  if (a) { a.snooze = Date.now() + SNOOZE_MS; saveAlarms(); }
  stopRing();
  say('9 more minutes…');
  renderAlarms();
}

// ---------- the alarm editor ----------
let editing: Alarm | null = null;
let editingNew = false;

function openEditor(a?: Alarm): void {
  unlockAudio();
  if (a) { editing = { ...a, days: [...a.days] }; editingNew = false; }
  else {
    const d = new Date(now().getTime() + 60 * 60e3);
    editing = { id: newId(), h: alarms.length ? 7 : d.getHours(), m: 0, on: true, days: [1, 2, 3, 4, 5], snooze: null, fired: null };
    editingNew = true;
  }
  renderView(); renderEditor();
}
function closeEditor(): void { editing = null; renderView(); renderAlarms(); }
function saveEditor(): void {
  if (!editing) return;
  const a = editing;
  a.on = true; a.snooze = null; arm(a);
  const i = alarms.findIndex(x => x.id === a.id);
  if (i >= 0) alarms[i] = a; else alarms.push(a);
  saveAlarms();
  report('clock:alarm:save');
  closeEditor();
  act('hop', true);
  const n = nextFire(a);
  say(n != null ? `see you ${whenWord(n)}!` : 'saved!');
}
// delete is quick and reversible: the alarm list offers "Undo delete" for a few seconds
let lastDeleted: { a: Alarm; at: number } | null = null;
let undoT: number | undefined;
/** The label row in the editor: the on-screen keyboard (core/web/keyboard.ts), Save on its bar, 40 characters at most. */
function editLabel(): void {
  if (!editing) return;
  const a = editing;
  Keyboard.open({
    value: labelOf(a), placeholder: 'A label, like Gym or Bins', done: 'Save', autoCap: true, max: LABEL_MAX,
    onDone: text => {
      if (editing === a) { const t = text.trim().slice(0, LABEL_MAX); a.label = t || undefined; renderEditor(); }
    },
  });
}
function deleteEditing(): void {
  if (!editing) return;
  const at = alarms.findIndex(x => x.id === editing!.id);
  if (at >= 0) lastDeleted = { a: { ...alarms[at], days: [...alarms[at].days] }, at };
  alarms = alarms.filter(x => x.id !== editing!.id);
  saveAlarms();
  closeEditor();
  clearTimeout(undoT);
  $('ckAlUndo').hidden = !lastDeleted;
  undoT = window.setTimeout(() => { lastDeleted = null; $('ckAlUndo').hidden = true; }, 6000);
}
function undoDelete(): void {
  if (!lastDeleted) return;
  alarms.splice(Math.min(lastDeleted.at, alarms.length), 0, lastDeleted.a);
  lastDeleted = null;
  clearTimeout(undoT);
  $('ckAlUndo').hidden = true;
  saveAlarms(); renderAlarms();
  say('back on the list!');
}
function editDial(unit: 'h' | 'm' | 'p', d: number): void {
  if (!editing) return;
  if (unit === 'h') {
    if (H12) { const pm = editing.h >= 12; editing.h = (((editing.h % 12) + d + 12) % 12) + (pm ? 12 : 0); }
    else editing.h = (editing.h + d + 24) % 24;
  } else if (unit === 'm') editing.m = (editing.m + d + 60) % 60;
  renderEditor();
}
function setPeriod(pm: boolean): void {
  if (!editing) return;
  editing.h = (editing.h % 12) + (pm ? 12 : 0);
  renderEditor();
}

function renderEditor(): void {
  if (!editing) return;
  const a = editing, set = $('ckEdSet');
  $('ckEdTitle').textContent = editingNew ? 'New alarm' : 'Edit alarm';
  setDigit(set, 'h', H12 ? String(a.h % 12 || 12) : pad(a.h));
  setDigit(set, 'm', pad(a.m));
  set.querySelectorAll<HTMLElement>('.ck-ampm button').forEach(b => b.classList.toggle('on', (b.dataset.pm === '1') === (a.h >= 12)));
  const d = now(), probe = { ...a, on: true, snooze: null };
  const n = nextFire(probe, d);
  $('ckEdHint').textContent = n != null ? `rings ${whenWord(n, d)} · in ${words(n - d.getTime())}` : '';
  const lbl = labelOf(a);
  $('ckEdLabelText').textContent = lbl || 'None';
  $('ckEdLabelText').classList.toggle('none', !lbl);
  $('ckEdDelete').hidden = editingNew;
  $('ckDays').querySelectorAll<HTMLElement>('button').forEach(b => b.classList.toggle('on', a.days.includes(+b.dataset.day!)));
  $('ckRepeatQuick').querySelectorAll<HTMLElement>('.ck-chip').forEach(c => c.classList.toggle('on', c.dataset.days === [...a.days].sort().join()));
  $('ckRepeatNote').textContent = a.days.length ? `· ${repeatLabel(a.days)}` : '· rings once, then turns itself off';
}

// ---------- the clock tab and the scene's words ----------
function greeting(h: number): string {
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
}
const dayOfYear = (d: Date) => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 864e5) + 1;
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
function zoneName(d: Date): string {
  try { return new Intl.DateTimeFormat([], { timeZoneName: 'long' }).formatToParts(d).find(x => x.type === 'timeZoneName')?.value || 'Local time'; }
  catch { return 'Local time'; }
}

function renderClockWords(d: Date): void {
  const y = d.getFullYear(), days = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
  $('ckGreeting').textContent = greeting(d.getHours());
  $('ckDate').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const n = nextAlarm(d);
  $('ckSub').textContent = `Day ${dayOfYear(d)} of ${days} · ${y}` + (n ? ` · alarm ${whenWord(n.at, d)} at ${hm(new Date(n.at))}` : '');
  $('ckZoneText').textContent = zoneName(d);
  const mins = d.getHours() * 60 + d.getMinutes(), left = 1440 - mins;
  $('ckDayNote').textContent = `· ${Math.floor(mins / 14.4)}% gone, ${words(left * 60e3)} to midnight`;
  $('ckWeekNum').textContent = `· week ${isoWeek(d)}`;
  const today = (d.getDay() + 6) % 7;
  $('ckWeekDots').innerHTML = WEEK.map((day, i) =>
    `<div class="${i < today ? 'past' : i === today ? 'today' : ''}${i > 4 ? ' weekend' : ''}"><i></i>${dayName(day)}</div>`).join('');
}

// ---------- the sky outside: the critter's scene follows the real weather (from the Weather app's server) ----------
type Sky = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';
let sky: Sky = 'clear';
const skyOf = (code: number): Sky =>
  code <= 1 ? 'clear' : code === 2 ? 'partly' : code === 3 ? 'cloudy' : code <= 48 ? 'fog'
  : code >= 95 ? 'storm' : (code >= 71 && code <= 77) || code === 85 || code === 86 ? 'snow' : 'rain';
async function refreshSky(): Promise<void> {
  try {
    const r = await fetch('/api/weather/forecast', { cache: 'no-store' });
    if (!r.ok) return;
    const f = await r.json() as { current?: { weather_code?: number } };
    if (typeof f.current?.weather_code !== 'number') return;
    sky = skyOf(f.current.weather_code);
    (['clear', 'partly', 'cloudy', 'fog', 'rain', 'snow', 'storm'] as Sky[]).forEach(k => ctx.root.classList.toggle(`ck-sky-${k}`, k === sky));
    renderStatus();
  } catch { /* offline: keep the last sky */ }
}
const DAY_LINE: Record<Sky, string> = {
  clear: 'Out in the sun', partly: 'Sun and clouds', cloudy: 'Under grey skies', fog: 'Lost in the fog',
  rain: 'Staying dry inside', snow: 'Watching the snow', storm: 'Hiding from the storm',
};

function renderStatus(): void {
  let s: string, sub: string;
  if (ringing) { s = ringing.kind === 'alarm' ? 'Rise and shine!' : 'Time’s up!'; sub = 'tap Stop to quiet it'; }
  else if (soonestLeft() != null) { s = 'Watching the sand'; sub = `${dur(soonestLeft()!)} left on the timer`; }
  else if (sw.running) { s = 'Jogging along'; sub = sw.laps.length ? `${sw.laps.length} lap${sw.laps.length > 1 ? 's' : ''} so far` : 'keeping time for you'; }
  else {
    s = { night: 'Fast asleep', morning: 'Waking up', day: DAY_LINE[sky], evening: 'Winding down' }[phase || 'day'];
    const n = nextAlarm();
    sub = n ? `alarm ${whenWord(n.at)} at ${hm(new Date(n.at))}` : phase === 'night' ? 'tap to say hi' : 'tap me!';
  }
  $('ckStatus').textContent = s;
  $('ckStatusSub').textContent = sub;
}

function tabDot(m: Mode, on: boolean): void {
  ctx.$('ckTabs').querySelector(`[data-mode="${m}"]`)?.classList.toggle('ck-dot', on && mode !== m);
}

/** "tap to show seconds" under the clock until the first tap on the time (or while seconds are already showing). */
function paintSecHint(): void {
  $('ckSecHint').hidden = showSeconds || store.get(K.secHint) === '1';
}

function renderView(): void {
  const v: View = ringing ? 'ring' : mode === 'alarm' && editing ? 'edit' : mode;
  ctx.root.dataset.view = v;
  ctx.root.dataset.mode = mode;
}

function setMode(m: Mode): void {
  editing = null;
  mode = m;
  store.set(K.mode, m);
  renderView();
  ctx.$('ckTabs').querySelectorAll<HTMLElement>('button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  renderTimer(); renderSw(); renderLaps(); renderAlarms(); renderStatus();
}

// ---------- ticking ----------
// The clock moves once a minute. Seconds are only needed while something shows them: a running timer (its countdown
// and the rail's), the stopwatch, or the seconds on screen. Alarms are checked on the minute; a snooze that ends
// sooner than the next minute gets its own wake-up.
let tickT: number | undefined;
function tickWait(): number {
  const real = Date.now(), onScreen = ctx.isVisible() && !document.hidden;
  if (anyRunning() || (onScreen && (showSeconds || sw.running))) return 1e3 - real % 1e3 + 20;
  let wait = 60e3 - (real + offset) % 60e3 + 20;
  for (const a of alarms) if (a.snooze && a.snooze > real) wait = Math.min(wait, a.snooze - real + 20);
  return wait;
}
function armTick(): void {
  clearTimeout(tickT);
  tickT = window.setTimeout(tickLoop, tickWait());
}
function tickLoop(): void {
  try { tick(); } finally { armTick(); }
}

let lastMinute = -1;
function tick(): void {
  const d = now(), t = timeParts(d);

  const minuteKey = d.getHours() * 60 + d.getMinutes();
  if (minuteKey !== lastMinute) {
    const first = lastMinute < 0;
    lastMinute = minuteKey;
    ctx.header.icon.innerHTML = railIcon(d);
    renderClockWords(d);
    setPhase(phaseOf(d.getHours()), !first);
    if (!first && d.getMinutes() === 0 && phase !== 'night' && !ringing) { act('hop', true); say(`${hourWord(d)} o’clock!`); }
    renderAlarms();
    if (editing) renderEditor();
    if (!anyRunning()) renderTimer();
  }

  // the clock tab
  $('ckTime').innerHTML = `${t.hour}:${t.minute}${showSeconds ? `<span class="ck-secs">:${pad(d.getSeconds())}</span>` : ''}`
    + (t.period ? `<small>${t.period}</small>` : '');
  const pct = ((d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 864).toFixed(2);
  $('ckDayFill').style.width = `${pct}%`;
  $('ckDayNow').style.left = `${pct}%`;

  // the timer
  // the timers: one that has ended leaves the list. The first rings unless an alarm or timer already rings; the others get a notice.
  const nowMs = Date.now();
  const ended = timers.filter(x => x.end && x.end <= nowMs);
  if (ended.length) {
    timers = timers.filter(x => !ended.includes(x));
    if (ended.includes(timer)) timer = draftOf(timer.dur);
    saveTimers();
    ended.forEach((x, i) => {
      const total = x.dur, late = nowMs - x.end!, lbl = `${x.name} · `;
      if (i === 0 && late < 5 * 60e3 && !ringing) ring({ kind: 'timer', id: null, started: Date.now(), title: 'Time’s up', big: dur(0), sub: `${lbl}Your ${lengthWords(total)} timer is done.` });
      else alertFor('timer', { title: 'Timer finished', body: `${lbl}Your ${lengthWords(total)} timer finished at ${hm(new Date(x.end! + offset))}.`, app: 'clock' }, undefined, ctx.isVisible());
    });
    renderTimer();
  } else if (anyRunning()) renderTimer();
  checkAlarms(d);
  renderRingFor();

  // the rail: the countdown of the soonest running timer, otherwise the time
  const soon = soonestLeft();
  ctx.setRail({ icon: railIcon(d), label: soon != null ? dur(soon) : `${t.hour}:${t.minute}`, busy: soon != null || !!ringing });
  renderStatus();
}

function mount(context: AppContext): void {
  ctx = context;
  drawSky();
  ctx.root.addEventListener('pointerdown', unlockAudio, true);
  // the Home screen's "5-min timer" shortcut
  addEventListener('hub:timer', e => { const ms = (e as CustomEvent<number>).detail; if (ms > 0) timerStart(ms); });
  // the drawer's Timer tile: open on that tab (system.ts opens Clock first)
  addEventListener('hub:clock-tab', e => setMode((e as CustomEvent<Mode>).detail));

  // Settings → Apps → Clock
  registerAppSettings({
    app: manifest.id, name: manifest.name, icon: app.icon, blurb: 'Seconds, alarms and the timer',
    rows: () => [
      { kind: 'switch', id: 'seconds', title: 'Show seconds', detail: 'On the big clock.',
        get: () => showSeconds, set: v => { showSeconds = v; store.set(K.secs, v ? '1' : '0'); tick(); } },
      { kind: 'action', id: 'alarms', title: 'Alarms', detail: 'Set, repeat and switch off alarms in the Clock app.',
        value: () => { const n = alarms.filter(a => a.on).length; return n ? `${n} on` : 'None on'; }, label: 'Open',
        run: () => { openApp(manifest.id); setMode('alarm'); } },
      { kind: 'action', id: 'timer', title: 'Timer', detail: 'Presets and a dial for any length.',
        value: () => (soonestLeft() != null ? `${dur(soonestLeft()!)} left` : 'Not running'), label: 'Open',
        run: () => { openApp(manifest.id); setMode('timer'); } },
    ],
  });

  // tabs
  $('ckTabs').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-mode]');
    if (!b || ringing) return;
    report(`clock:tab:${b.dataset.mode}`);
    setMode(b.dataset.mode as Mode);
  });
  $('ckNext').addEventListener('click', () => { if (!ringing) setMode('alarm'); });

  // clock
  $('ckTime').addEventListener('click', () => {
    showSeconds = !showSeconds; store.set(K.secs, showSeconds ? '1' : '0');
    store.set(K.secHint, '1'); paintSecHint();   // the one-time "tap to show seconds" line goes after the first tap
    tick();
  });

  // timer
  const tset = $('ckTimerSet');
  tset.append(spinner('h', 'hr', d => timerDial('h', d)), sep(), spinner('m', 'min', d => timerDial('m', d)), sep(), spinner('s', 'sec', d => timerDial('s', d)));
  $('ckPresets').innerHTML = TIMER_PRESETS.map(m =>
    `<button class="ck-chip" data-min="${m}">${m >= 60 ? m / 60 : m}<small>${m >= 60 ? 'hr' : 'min'}</small></button>`).join('');
  $('ckPresets').addEventListener('click', e => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.ck-chip');
    if (c) { report(`clock:timer:${c.dataset.min}`); timerStart(+c.dataset.min! * 60e3); }
  });
  $('ckTimerGo').addEventListener('click', () => (timer.end ? timerPause() : timerStart()));
  $('ckTimerReset').addEventListener('click', timerReset);
  $('ckTimerMinus').addEventListener('click', () => timerNudge(-1));
  $('ckTimerPlus').addEventListener('click', () => timerNudge(1));

  // stopwatch
  $('ckSwGo').addEventListener('click', swToggle);
  $('ckSwLap').addEventListener('click', swLap);
  $('ckSwReset').addEventListener('click', swReset);

  // alarms
  $('ckAlarmPresets').innerHTML = ALARM_PRESETS.map(([h, m]) => {
    const p = alarmParts(h, m);
    return `<button class="ck-chip" data-h="${h}" data-m="${m}">${p.hm}<small>${p.period}</small></button>`;
  }).join('');
  $('ckAlarmPresets').addEventListener('click', e => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.ck-chip');
    if (c) { report('clock:alarm:quick'); quickAdd(+c.dataset.h!, +c.dataset.m!); }
  });
  $('ckAlAdd').addEventListener('click', () => openEditor());
  $('ckAlList').addEventListener('click', e => {
    const el = e.target as HTMLElement, sw = el.closest<HTMLElement>('[data-toggle]');
    if (sw) { alarmToggle(sw.dataset.toggle!); return; }
    const row = el.closest<HTMLElement>('.ck-arow');
    const a = row && alarms.find(x => x.id === row.dataset.id);
    if (a) openEditor(a);
  });

  // the editor
  const eset = $('ckEdSet');
  eset.append(spinner('h', H12 ? 'hour' : 'hr', d => editDial('h', d)), sep(), spinner('m', 'min', d => editDial('m', d)));
  if (H12) {
    const ap = document.createElement('div');
    ap.className = 'ck-ampm';
    ap.innerHTML = `<button data-pm="0">${PERIODS[0]}</button><button data-pm="1">${PERIODS[1]}</button>`;
    ap.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (b) setPeriod(b.dataset.pm === '1'); });
    eset.append(ap);
  }
  $('ckDays').innerHTML = WEEK.map(d => `<button data-day="${d}">${dayName(d)}</button>`).join('');
  $('ckDays').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b || !editing) return;
    const d = +b.dataset.day!;
    editing.days = editing.days.includes(d) ? editing.days.filter(x => x !== d) : [...editing.days, d];
    renderEditor();
  });
  $('ckRepeatQuick').innerHTML = [['Once', ''], ['Weekdays', '1,2,3,4,5'], ['Weekends', '0,6'], ['Every day', '0,1,2,3,4,5,6']]
    .map(([name, days]) => `<button class="ck-chip" data-days="${days}">${name}</button>`).join('');
  $('ckRepeatQuick').addEventListener('click', e => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.ck-chip');
    if (!c || !editing) return;
    editing.days = c.dataset.days ? c.dataset.days.split(',').map(Number) : [];
    renderEditor();
  });
  $('ckEdSave').addEventListener('click', saveEditor);
  $('ckEdCancel').addEventListener('click', closeEditor);
  $('ckEdLabel').addEventListener('click', editLabel);
  $('ckEdDelete').addEventListener('click', deleteEditing);
  $('ckAlUndo').addEventListener('click', undoDelete);

  // ringing
  $('ckRingStop').addEventListener('click', () => { report('clock:ring:stop'); stopRing(); });
  $('ckRingSnooze').addEventListener('click', () => {
    if (!ringing) return;
    report(`clock:ring:${ringing.kind === 'alarm' ? 'snooze' : 'more'}`);
    if (ringing.kind === 'alarm') snooze();
    else { stopRing(); setMode('timer'); timerStart(60e3); }
  });

  // Back (system.ts): a ringing alarm snoozes (never dismisses; a timer adds its minute, as its button does), then the
  // alarm editor closes, then the tabs go back to the Clock tab. Only while Clock is on screen.
  onBack(() => {
    if (!ctx.isVisible()) return false;
    if (ringing) { $('ckRingSnooze').click(); return true; }
    if (editing) { closeEditor(); return true; }
    if (mode !== 'clock') { setMode('clock'); return true; }
    return false;
  }, 10);

  $('ckScene').addEventListener('click', onCritterTap);

  setMode(mode);
  paintSecHint();
  tick();
  // a reload in the middle of ringing carries on ringing
  const r = readJson<RingState>(K.ring);
  if (r && r.kind && Date.now() - r.started < RING_LIMIT[r.kind]) ring(r, false);
  else store.set(K.ring, null);
  void refreshSky();
  setInterval(() => void refreshSky(), 15 * 60e3);
  // any change to the timer, stopwatch, seconds or ringing state re-times the tick (store writes say so)
  onStore(k => { if (k === K.timers || k === K.sw || k === K.secs || k === K.ring || k === K.alarms) tickLoop(); });
  // a tap on a timer's row focuses it; "New timer" brings the dial back
  $('ckTimerList').addEventListener('click', e => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.ck-trow');
    if (!row) return;
    if (row.dataset.new) { report('clock:timer:new'); newTimer(); return; }
    const t = timers[+row.dataset.i!];
    if (t) { timer = t; renderTimer(); }
  });
  armTick();   // the idle acts (scheduleAct) start when the Clock is on screen (onShow)
}

// ---------- for voice commands ("set a timer for 10 minutes", "wake me up at 7") ----------
// Registered with core/web/voice-commands.ts when the Clock mounts; nothing else changes here.
const clockApi: ClockApi = {
  startTimer(ms: number, label?: string): void { timerStart(Math.max(1e3, Math.min(24 * 3600e3, ms)), label?.trim().slice(0, LABEL_MAX) || undefined); },
  addLabelled(h: number, m: number, label: string, days: number[] = []): { when: string; at: number } | null {
    unlockAudio();
    const lbl = label.trim().slice(0, LABEL_MAX);
    const same = (x: Alarm) => JSON.stringify([...x.days].sort()) === JSON.stringify([...days].sort());
    // the same time, words and days again: switch that one back on rather than adding a twin
    let a = alarms.find(x => x.claude && x.h === h && x.m === m && labelOf(x) === lbl && same(x));
    if (!a) {
      // a full list: Claude's own one-off alarms that have already rung make room (the user's own are never touched)
      if (alarms.length >= MAX_ALARMS) alarms = alarms.filter(x => !(x.claude && !x.on && !x.snooze && !x.days.length));
      if (alarms.length >= MAX_ALARMS) return null;
      a = { id: newId(), h, m, on: true, days: [...days], snooze: null, fired: null, claude: true, ...(lbl ? { label: lbl } : {}) };
      alarms.push(a);
    }
    a.on = true; a.snooze = null; arm(a);
    saveAlarms(); renderAlarms(); renderNextPill();
    act('hop', true); say(`see you at ${alarmParts(h, m).hm}!`);
    const at = nextFire(a);
    return at == null ? null : { when: whenWord(at), at: at - offset };
  },
  active(): number { return timers.length + alarms.filter(a => a.on || a.snooze).length; },
  /** True if there was a timer to cancel: the timer a voice or drawer action picks (see actionTimer). */
  cancelTimer(): boolean { focusAction(); const had = isListed(timer); timerReset(); return had; },
  pauseTimer(): boolean { focusAction(); if (!timer.end) return false; timerPause(); return true; },
  /** Resume the paused timer in the list, even when another timer is running. */
  resumeTimer(): boolean { const paused = timers.find(t => !t.end && t.left != null); if (!paused) return false; timer = paused; timerStart(); return true; },
  nudgeTimer(minutes: number): boolean {
    focusAction();
    if (!timer.end && timer.left == null) return false;
    const steps = Math.min(60, Math.abs(Math.round(minutes)));
    for (let i = 0; i < steps; i++) timerNudge(minutes > 0 ? 1 : -1);
    return true;
  },
  /** ms left on a running (or paused) timer, null when none is set. */
  timerLeft(): number | null { const t = actionTimer(); return t.end ? Math.max(0, t.end - Date.now()) : t.left; },
  /** Add (or switch on) an alarm; days as Date.getDay() values, [] = once. Returns when it next rings. */
  addAlarm(h: number, m: number, days: number[]): { when: string; at: number } | null {
    unlockAudio();
    let a = alarms.find(x => x.h === h && x.m === m);
    if (!a) {
      if (alarms.length >= MAX_ALARMS) return null;
      a = { id: newId(), h, m, on: true, days: [], snooze: null, fired: null };
      alarms.push(a);
    }
    a.days = [...days]; a.on = true; a.snooze = null; arm(a);
    saveAlarms(); renderAlarms(); renderNextPill();
    act('hop', true); say(`see you at ${alarmParts(h, m).hm}!`);
    const at = nextFire(a);
    return at == null ? null : { when: whenWord(at), at: at - offset };
  },
  /** Switch off only the alarms and reminders Claude set (they stay in the list). Returns how many were on. */
  cancelClaudeAlarms(): number {
    let n = 0;
    for (const a of alarms) { if (a.claude && (a.on || a.snooze)) { n++; a.on = false; a.snooze = null; } }
    if (n) { saveAlarms(); renderAlarms(); renderNextPill(); }
    return n;
  },
  /** Switch off the alarm at one time (it stays in the list). Returns how many were on. */
  switchOffAlarm(h: number, m: number): number {
    let n = 0;
    for (const a of alarms) { if (a.h === h && a.m === m && (a.on || a.snooze)) { n++; a.on = false; a.snooze = null; } }
    if (n) { saveAlarms(); renderAlarms(); renderNextPill(); }
    return n;
  },
  /** Switch every alarm off (they stay in the list). Returns how many were on. */
  alarmsOff(): number {
    let n = 0;
    for (const a of alarms) { if (a.on || a.snooze) n++; a.on = false; a.snooze = null; }
    saveAlarms(); renderAlarms(); renderNextPill();
    return n;
  },
  /** The ring now: 'alarm' or 'timer', null when nothing rings. */
  ringing(): 'alarm' | 'timer' | null { return ringing ? ringing.kind : null; },
  /** Silence and dismiss the ring. False when nothing rings. */
  stopRinging(): boolean { if (!ringing) return false; stopRing(); return true; },
  /** Snooze a ringing alarm. False when nothing rings or a timer does. */
  snoozeRinging(): boolean { if (!ringing || ringing.kind !== 'alarm') return false; snooze(); return true; },
  /** The next alarm to ring: its time and "today" / "tomorrow" / a weekday. */
  nextAlarm(): { h: number; m: number; when: string } | null {
    const n = nextAlarm();
    return n ? { h: n.a.h, m: n.a.m, when: whenWord(n.at) } : null;
  },
};

const app: HubApp = {
  ...manifest,
  icon: railIcon(),
  mount: c => { mount(c); provideClock(clockApi); },
  onShow() {
    tick(); renderSw(); armTick(); scheduleAct();
    if (phase === 'morning' && Math.random() < .5 && !ringing) { act('stretch', true); say('*yawn*'); }
  },
  onHide() { clearTimeout(actT); actT = undefined; armTick(); },
  // closed in the app switcher: back to the Clock tab (timers and alarms keep running and still ring)
  onClose() { if (!ringing) setMode('clock'); },
};
export default app;
