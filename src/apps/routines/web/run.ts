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
// The routines are read from the PC (GET /api/routines/list) and kept for a minute, for voice matching; a change in
// the Routines app sends hub:routines, which drops the copy. This module provides itself to voice-commands.ts
// (provideRoutines) as soon as it loads, so voice, the Home screen and Claude's run_routine all start routines here.
import { getJson, postJson } from '../../../core/web/dom.ts';
import { voice } from '../../../core/web/device.ts';
import { calendarCommand, getClock, provideRoutines, weatherToday } from '../../../core/web/voice-commands.ts';
import { voiceUi } from '../../../core/web/voice-ui.ts';
import { prefs, sleep as showScreenSaver } from '../../../core/web/system.ts';
import type { HaResult } from '../../home-assistant/api.ts';
import { AT_WINDOW_MIN, STEP_MAX_MS, dayKey, dueRoutines, type Routine, type RoutinesResult, type Step } from '../api.ts';

const CACHE_MS = 60e3;
let cache: Routine[] | null = null, cacheAt = 0;

/** The routines (the copy from the last minute, unless `fresh`). */
export async function loadRoutines(fresh = false): Promise<Routine[]> {
  if (!fresh && cache && Date.now() - cacheAt < CACHE_MS) return cache;
  const r = await getJson<RoutinesResult>('/api/routines/list');
  if (!r || !Array.isArray(r.routines)) throw new Error('no routines');
  cache = r.routines; cacheAt = Date.now();
  return cache;
}
addEventListener('hub:routines', () => { cache = null; });

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
      const r = await until(postJson<HaResult & { name?: string }>('/api/home-assistant/scene', { entity_id: s.entity_id }), deadline, null);
      if (r?.ok) return '';   // the lights changing say it
      return r ? `Couldn’t set the scene ${r.name || 'for this routine'}.` : 'The scene didn’t answer in time.';
    }
    case 'timer': {
      const clock = getClock();
      if (!clock) return 'The clock isn’t ready, so no timer.';
      if (clock.timerLeft() != null) return 'A timer is already running, so I left it.';
      clock.startTimer(s.minutes * 60e3);
      return `Timer set for ${s.minutes} minute${s.minutes === 1 ? '' : 's'}.`;
    }
    case 'pause': await sleep(Math.min(s.seconds * 1000, deadline - Date.now())); return '';
    case 'quiet': prefs.dnd = s.on; return '';   // the same switch as the Control Center tile
    case 'ambient': showScreenSaver(); return '';
    case 'lists': {
      // the open items of one list, read aloud (the same lists the Lists app and voice use)
      type Lists = { lists: { id: string; name: string; items: { text: string; done: boolean }[] }[] };
      const r = await until(getJson<Lists>('/api/lists/lists'), deadline, null);
      if (!r) return 'The lists didn’t answer in time.';
      const l = r.lists.find(x => x.id === s.list);
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

/** Start a routine by id (read from the PC, so only a saved one runs). False when there is no such routine. */
export async function runRoutine(id: string): Promise<boolean> {
  let list: Routine[];
  try { list = await loadRoutines(true); } catch { try { list = await loadRoutines(); } catch { return false; } }
  const r = list.find(x => x.id === id);
  if (!r || !r.steps.length) return false;
  void runSteps(r);
  return true;
}

/** End the routine that is running, if any (the speech it started is left to finish). */
export function stopRoutine(): void { if (state) { token++; setState(null); } }

// ---------- routines with a time: run by themselves, once a day, within AT_WINDOW_MIN of the time ----------
// The tablet keeps the day each one last ran (this device's memory only), so a restart does not run it twice.
const RAN_KEY = 'routines.ran';
function ranDays(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(RAN_KEY) || '{}') as Record<string, string>; } catch { return {}; }
}
function markRan(id: string, day: string): void {
  try { localStorage.setItem(RAN_KEY, JSON.stringify({ ...ranDays(), [id]: day })); } catch { /* not kept: it may run once more today */ }
}

async function schedulerTick(): Promise<void> {
  if (state) return;   // one routine at a time: the next tick picks up anything else that is due
  let list: Routine[];
  try { list = await loadRoutines(); } catch { return; }
  const now = new Date();
  const due = dueRoutines(list, now, ranDays())[0];
  if (!due) return;
  markRan(due.id, dayKey(now));   // marked first, so a routine that fails is not tried again and again today
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
  run: id => runRoutine(id),
});
