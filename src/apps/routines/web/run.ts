// Running a routine on the tablet: its steps, in order, through what already exists.
//   weather    the "what's the weather" answer (core/web/voice-commands.ts weatherToday), spoken
//   calendar   the "what's on today" answer (calendarCommand: GET /api/calendar/events), spoken
//   say        the fixed line, spoken
//   scene      POST /api/home-assistant/scene, the same route as a Home tile (the PC allows only a scene on Home)
//   timer      the Clock's timer (ClockApi.startTimer), as "set a timer for 5 minutes" does
//   pause      a short wait (10 s at most)
// Speaking goes through the voice indicator (voiceUi.say), and the next step waits for the line to finish. No step
// is waited on for more than STEP_MAX_MS (10 s): its fetch and its speech share that time, then the routine goes on.
// A step that fails is said as one short sentence and the routine goes on. One routine runs at a time: a new one (or
// "stop" said while it speaks) ends the one before.
//
// The routines come from the tablet's copy (web/sync.ts), which works with the PC off. Without a copy yet (the first
// run) they are read from the PC (GET /api/routines/list) and kept for a minute; a change in the Routines app sends
// hub:routines, which drops that copy. This module provides itself to voice-commands.ts (provideRoutines) as soon as
// it loads, so voice, the Home screen and Claude's run_routine all start routines here.
import { getJson, postJson, store } from '../../../core/web/dom.ts';
import { voice } from '../../../core/web/device.ts';
import { calendarCommand, getClock, provideRoutines, weatherToday } from '../../../core/web/voice-commands.ts';
import { readLists } from '../../lists/web/readers.ts';
import { voiceUi } from '../../../core/web/voice-ui.ts';
import { prefs, setFocus, sleep as showScreenSaver } from '../../../core/web/system.ts';
import type { HaResult } from '../../home-assistant/api.ts';
import { AT_WINDOW_MIN, STEP_MAX_MS, dueDay, parseRanDays, type Routine, type RoutinesResult, type Step } from '../api.ts';
import { sceneStepWords } from './local.ts';
import { copyAge, hasCopy, localRoutines, pull } from './sync.ts';

const CACHE_MS = 60e3;
const LIST_TIMEOUT_MS = 10e3;   // a list the PC never answers gives up, so a run does not wait on it forever
let cache: Routine[] | null = null, cacheAt = 0;
let cacheGen = 0;   // a hub:routines event bumps it: a read that started before the event cannot refill the cache

/** The routines: the tablet's copy (pulled from the PC when it is a minute old, or with `fresh`), else the PC's copy
 *  from the last minute. */
export async function loadRoutines(fresh = false): Promise<Routine[]> {
  if (hasCopy()) {
    if (fresh || copyAge() > CACHE_MS) await pull();
    return localRoutines() ?? [];
  }
  if (!fresh && cache && Date.now() - cacheAt < CACHE_MS) return cache;
  const gen = cacheGen;
  const r = await getJson<RoutinesResult>('/api/routines/list', LIST_TIMEOUT_MS);
  if (!r || r.ok === false || !Array.isArray(r.routines)) throw new Error('no routines');   // the PC could not read its list: not an empty one
  if (gen === cacheGen) { cache = r.routines; cacheAt = Date.now(); }   // an event came during the read: its old list is not kept
  return r.routines;
}
addEventListener('hub:routines', () => { cache = null; cacheGen++; });

// ---------- what is running, for the Home tiles and the Routines page ----------
export interface RunState { id: string; name: string; step: number; of: number }
let state: RunState | null = null;
const watchers: ((s: RunState | null) => void)[] = [];
export function onRunState(fn: (s: RunState | null) => void): void { watchers.push(fn); }
export const runState = (): RunState | null => state;
function setState(s: RunState | null): void { state = s; for (const w of watchers) { try { w(s); } catch { /* one bad watcher */ } } }

// ---------- speaking, and waiting for it ----------
let token = 0, lineN = 0;
const waiting = new Map<string, () => void>();
voice.on(e => {
  if (e.type === 'spoken') { waiting.get(e.id)?.(); waiting.delete(e.id); }
  if (e.type === 'stop' && state) { token++; setState(null); }   // "stop" said over a routine: it ends there
});

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, Math.max(0, ms)));

/** Wait for a promise until `deadline`; `late` after that. */
function until<T>(p: Promise<T>, deadline: number, late: T): Promise<T> {
  return new Promise<T>(resolve => {
    const t = setTimeout(() => resolve(late), Math.max(0, deadline - Date.now()));
    p.then(v => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(late); });
  });
}

/** Say a line and wait until it has been said (or the step's time is up). Off the tablet nothing is heard: a short beat. */
function speak(text: string, deadline: number): Promise<void> {
  if (!text.trim()) return Promise.resolve();
  if (!voice.available) return sleep(Math.min(1200, deadline - Date.now()));
  const id = `routine-${++lineN}`;
  return new Promise<void>(resolve => {
    const done = () => { clearTimeout(t); waiting.delete(id); resolve(); };
    const t = setTimeout(done, Math.max(0, deadline - Date.now()));
    waiting.set(id, done);
    voiceUi.say(text, id);
  });
}

// ---------- the steps ----------
/** One step: the words to say ('' for none). Never throws; a failure is a short sentence. */
async function doStep(s: Step, deadline: number): Promise<string> {
  switch (s.kind) {
    case 'say': return s.text;
    case 'weather': return (await until(weatherToday(), deadline, null))?.say ?? 'The weather didn’t come in time.';
    // cachedOnly: a timed routine never starts a Claude read of the connector (only the Calendar app and voice do)
    case 'calendar': return (await until(calendarCommand('today', true), deadline, null))?.say ?? 'The calendar didn’t answer in time.';
    case 'scene': {
      const r = await until(postJson<HaResult & { name?: string }>('/api/home-assistant/scene', { entity_id: s.entity_id }).catch(() => 'offline' as const), deadline, null);
      if (r === 'offline') return 'The PC isn’t answering, so the scene didn’t change.';
      return r ? sceneStepWords(r) : 'The scene didn’t answer in time.';
    }
    case 'timer': {
      const clock = getClock();
      if (!clock) return 'The clock isn’t ready, so no timer.';
      if (!clock.startTimer(s.minutes * 60e3)) return 'The Clock’s timer list is full, so no timer.';   // a new timer in the Clock's list; the ones already running keep going
      return `Timer set for ${s.minutes} minute${s.minutes === 1 ? '' : 's'}.`;
    }
    case 'pause': await sleep(Math.min(s.seconds * 1000, deadline - Date.now())); return '';
    case 'quiet': prefs.dnd = s.on; return '';   // the same switch as the Control Center tile
    case 'ambient': showScreenSaver(); return '';
    case 'focus': setFocus(s.mode); return '';   // the same switch as the Control Center focus tiles
    case 'radio': {
      // the Radio app keeps its recent stations on this tablet and plays the first one when it hears the event
      let last: unknown[] = [];
      try { last = JSON.parse(store.get('radio.recent') || '[]') as unknown[]; } catch { /* none kept */ }
      if (!last.length) return 'No radio station has played yet.';
      window.dispatchEvent(new CustomEvent('hub:radio-last'));
      return '';
    }
    case 'lists': {
      // the open items of one list, read aloud (the same lists the Lists app and voice use)
      const all = await until(readLists().catch(() => 'offline' as const), deadline, null);
      if (all === 'offline') return 'The PC isn’t answering, so the list can’t be read.';
      if (!all) return 'The lists didn’t answer in time.';
      const l = all.find(x => x.id === s.list);
      if (!l) return 'That list isn’t there.';
      const open = l.items.filter(i => !i.done).map(i => i.text);
      if (!open.length) return `Nothing left on ${l.name}.`;
      return `${l.name}: ${open.slice(0, 12).join(', ')}${open.length > 12 ? `, and ${open.length - 12} more` : ''}.`;
    }
  }
}

/** Run a routine's steps in order. A newer run (or "stop") ends this one between steps. */
async function runSteps(r: Routine): Promise<void> {
  const mine = ++token;
  for (let i = 0; i < r.steps.length; i++) {
    if (mine !== token) return;
    setState({ id: r.id, name: r.name, step: i + 1, of: r.steps.length });
    const deadline = Date.now() + STEP_MAX_MS;
    let words = '';
    try { words = await doStep(r.steps[i], deadline); } catch { words = 'One step didn’t work.'; }
    if (mine !== token) return;
    await speak(words, deadline);
  }
  if (mine === token) setState(null);
}

/** Why a routine did not start: not in the list, no steps, or the PC did not answer and no copy is recent. */
export type StartResult = 'started' | 'gone' | 'empty' | 'offline';

/** Start a routine by id (read from the PC, so only a saved one runs). Says why when it does not start. */
export async function startRoutine(id: string): Promise<StartResult> {
  let list: Routine[];
  try { list = await loadRoutines(true); } catch { try { list = await loadRoutines(); } catch { return 'offline'; } }
  const r = list.find(x => x.id === id);
  if (!r) return 'gone';
  if (!r.steps.length) return 'empty';
  void runSteps(r);
  return 'started';
}

/** End the routine that is running, if any (the speech it started is left to finish). */
export function stopRoutine(): void { if (state) { token++; setState(null); } }

// ---------- routines with a time: run by themselves, once a day, within AT_WINDOW_MIN of the time ----------
// The tablet keeps the day each one last ran (this device's memory only), so a restart does not run it twice.
const RAN_KEY = 'routines.ran';
// Kept in memory as well as saved, so a save that fails does not let a routine run again and again today. A restart can
// still run one again if its save failed.
let ranMem: Record<string, string> | null = null;
function ranDays(): Record<string, string> {
  if (!ranMem) { try { ranMem = parseRanDays(JSON.parse(localStorage.getItem(RAN_KEY) || '{}')); } catch { ranMem = {}; } }
  return ranMem;
}
function markRan(id: string, day: string): void {
  ranMem = { ...ranDays(), [id]: day };
  try { localStorage.setItem(RAN_KEY, JSON.stringify(ranMem)); } catch { /* kept in memory for this session */ }
}

async function schedulerTick(): Promise<void> {
  if (state) return;   // one routine at a time: the next tick picks up anything else that is due
  let list: Routine[];
  try { list = await loadRoutines(); } catch { return; }
  const now = new Date();
  const ran = ranDays();
  const due = list.find(x => dueDay(x, now, ran) !== null);
  if (!due) return;
  markRan(due.id, dueDay(due, now, ran)!);   // marked first, with the day it was due, so a routine that fails is not tried again
  void runSteps(due);
}

let scheduler: number | undefined;
/** Check the routines' times every 30 seconds, and once now. */
export function startScheduler(): void {
  if (scheduler !== undefined) return;
  scheduler = window.setInterval(() => void schedulerTick(), 30e3);
  void schedulerTick();
}
startScheduler();

provideRoutines({
  list: () => loadRoutines(),
  run: id => startRoutine(id),
  running: () => runState()?.id ?? null,
});
