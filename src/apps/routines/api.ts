// Routines: a named list of steps that run in order when you say one of its phrases or tap it.
// Shapes and limits shared by the page and the PC. Served to the browser: nothing secret lives here (the routines
// live on the tablet (web/sync.ts) and in .routines.json on the PC). The page checks only to give quick feedback; the server checks
// everything again (server/store.ts), including that a scene is on the dashboard or the Home screen.
import type { FocusId } from '../../core/web/focus-modes.ts';

export const MAX_ROUTINES = 12;
export const MAX_STEPS = 8;            // per routine
export const MAX_PHRASES = 4;          // per routine
export const MAX_NAME = 40;            // characters, a routine's name
export const MAX_PHRASE = 40;          // characters, one phrase
export const MAX_SAY = 160;            // characters, a fixed line to speak
export const MAX_TIMER_MIN = 720;      // minutes (the Clock's own limit for Claude's timers)
export const MAX_PAUSE_S = 10;         // seconds
export const STEP_MAX_MS = 10e3;       // the longest a routine waits for one step

/** A routine id: a lower-case letter, then letters, digits or dashes. */
export const ROUTINE_ID = /^[a-z][a-z0-9-]{0,31}$/;
const SCENE_ID = /^scene\.[a-z0-9_]+$/;

export type Step =
  | { kind: 'weather' }                          // speak today's weather (the "what's the weather" answer)
  | { kind: 'say'; text: string }                // speak a fixed line
  | { kind: 'calendar' }                         // read the calendar's next events today
  | { kind: 'scene'; entity_id: string }         // activate a Home Assistant scene on the dashboard or the Home screen
  | { kind: 'timer'; minutes: number }           // start the Clock's timer
  | { kind: 'pause'; seconds: number }           // wait 1 to 10 seconds
  | { kind: 'lists'; list: string }               // say the open items of a list: Shopping, To-do, or one the family made (its id)
  | { kind: 'quiet'; on: boolean }               // turn Do Not Disturb on or off
  | { kind: 'radio' }                           // play the Radio app's last station (the most recent one played)
  | { kind: 'focus'; mode: FocusId }           // turn a focus mode on: Work, Family or Sleep (core/web/focus-modes.ts)
  | { kind: 'ambient' };                         // show the screen saver now
export type StepKind = Step['kind'];
export const STEP_KINDS: StepKind[] = ['weather', 'calendar', 'say', 'scene', 'timer', 'pause', 'lists', 'quiet', 'ambient', 'focus', 'radio'];
/** The focus modes a routine can turn on, and their names for the step's label. */
export const FOCUS_NAMES: Record<FocusId, string> = { work: 'Work', family: 'Family', sleep: 'Sleep' };

export interface Routine {
  id: string;
  name: string;
  phrases: string[];                   // what you say to run it ("good morning"); the name works with "run ... routine" too
  steps: Step[];
  at?: RoutineTime;                    // runs by itself at this time, on these days (see RoutineTime)
}

/** When a routine runs by itself: a time of day (24-hour, the tablet's local time) and the days (0 = Sunday … 6 = Saturday).
 *  No days means every day. A routine runs at most once a day, within an hour after its time (the tablet's scheduler). */
export interface RoutineTime { h: number; m: number; days: number[] }
export const AT_WINDOW_MIN = 60;       // minutes after its time that a routine can still start

/** What every route answers: all the routines as they are now, and why a change was refused. */
export interface RoutinesResult {
  ok: boolean;
  routines: Routine[];
  error?: string;
  id?: string;                         // save: the routine's id (new or the same)
  stored?: boolean;                    // list: the PC has a routines file (false: the tablet may restore its copy)
  retry?: boolean;                     // the PC couldn't read or save its file: send the change again later
}

/** Plain text: no control characters, single spaces, trimmed. */
export function cleanText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The words of a phrase or a name, for comparing: lower case, letters, digits and spaces only. */
export const phraseKey = (s: string): string =>
  s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** One step checked: the clean step, or a short reason it can't be used. Scene ids are checked further on the PC. */
export function cleanStep(raw: unknown): Step | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'A step is missing.' };
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case 'weather': return { kind: 'weather' };
    case 'calendar': return { kind: 'calendar' };
    case 'say': {
      const text = cleanText(r.text);
      if (!text) return { error: 'A “Say” step needs some words.' };
      if (text.length > MAX_SAY) return { error: `A “Say” step can be ${MAX_SAY} characters at most.` };
      return { kind: 'say', text };
    }
    case 'scene': {
      const id = typeof r.entity_id === 'string' ? r.entity_id.trim() : '';
      if (!SCENE_ID.test(id) || id.length > 120) return { error: 'A scene step needs a scene from Home.' };
      return { kind: 'scene', entity_id: id };
    }
    case 'timer': {
      const m = r.minutes;
      if (typeof m !== 'number' || !Number.isInteger(m) || m < 1 || m > MAX_TIMER_MIN) return { error: `A timer can be from 1 to ${MAX_TIMER_MIN} minutes.` };
      return { kind: 'timer', minutes: m };
    }
    case 'pause': {
      const s = r.seconds;
      if (typeof s !== 'number' || !Number.isInteger(s) || s < 1 || s > MAX_PAUSE_S) return { error: `A pause can be from 1 to ${MAX_PAUSE_S} seconds.` };
      return { kind: 'pause', seconds: s };
    }
    case 'quiet': {
      if (typeof r.on !== 'boolean') return { error: 'A Do Not Disturb step needs on or off.' };
      return { kind: 'quiet', on: r.on };
    }
    case 'ambient': return { kind: 'ambient' };
    case 'radio': return { kind: 'radio' };
    case 'focus': {
      if (typeof r.mode !== 'string' || !Object.hasOwn(FOCUS_NAMES, r.mode)) return { error: 'A focus step needs Work, Family or Sleep.' };
      return { kind: 'focus', mode: r.mode as FocusId };
    }
    case 'lists': {
      const l = r.list;
      // a list id: shopping, todo, or one the family made (its id is lower case, letters, digits and dashes)
      if (typeof l !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(l)) return { error: 'A lists step needs a list.' };
      return { kind: 'lists', list: l };
    }
    default: return { error: 'That isn’t a step a routine can do.' };
  }
}

/** A routine's name, phrases and steps checked (not its id, nor scenes against Home): the clean parts, or why not. */
/** The day a time falls on, as a key ("2026-11-22"); a routine's run is marked with it. */
export const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The saved ran-today record as a map of routine id → day key. Anything that is not an object of text values is no record. */
export function parseRanDays(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [id, day] of Object.entries(raw as Record<string, unknown>)) if (typeof day === 'string') out[id] = day;
  return out;
}

/** The day key of the occurrence of a routine that is due now: today's, or yesterday's while its start window runs past midnight. null when none is. */
export function dueDay(r: Routine, now: Date, ran: Record<string, string>): string | null {
  if (!r.at) return null;
  for (const back of [0, 1]) {
    const t = new Date(now);
    t.setDate(t.getDate() - back);
    t.setHours(r.at.h, r.at.m, 0, 0);
    const day = dayKey(t);
    if (r.at.days.length && !r.at.days.includes(t.getDay())) continue;
    if (ran[r.id] === day) continue;
    const since = now.getTime() - t.getTime();
    if (since >= 0 && since < AT_WINDOW_MIN * 60e3) return day;
  }
  return null;
}

/** The routines whose time has come (ran: routine id → day key of its last run). */
export function dueRoutines(list: Routine[], now: Date, ran: Record<string, string>): Routine[] {
  return list.filter(r => dueDay(r, now, ran) !== null);
}

/** A routine's time: HH:MM and its days, or null when it doesn't run by itself. */
export function cleanTime(raw: unknown): RoutineTime | null | { error: string } {
  if (raw == null) return null;
  const bad = { error: 'That time isn’t right. Give it as HH:MM on the 24-hour clock.' };
  if (typeof raw !== 'object') return bad;
  const r = raw as Record<string, unknown>;
  const { h, m } = r;
  if (typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > 23) return bad;
  if (typeof m !== 'number' || !Number.isInteger(m) || m < 0 || m > 59) return bad;
  const days = Array.isArray(r.days) ? [...new Set(r.days as unknown[])] : [];
  if (days.some(d => typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6)) return { error: 'The days must be from Sunday to Saturday.' };
  return { h, m, days: (days as number[]).sort((a, b) => a - b) };
}

export function cleanRoutine(raw: unknown): { name: string; phrases: string[]; steps: Step[]; at?: RoutineTime } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'That isn’t a routine.' };
  const r = raw as Record<string, unknown>;
  const name = cleanText(r.name);
  if (!name) return { error: 'Give the routine a name.' };
  if (name.length > MAX_NAME) return { error: `A name can be ${MAX_NAME} characters at most.` };
  if (!phraseKey(name)) return { error: 'The name needs some letters or numbers.' };
  const phrases: string[] = [];
  for (const p of Array.isArray(r.phrases) ? r.phrases : []) {
    const t = cleanText(p);
    if (!t) continue;
    if (t.length > MAX_PHRASE) return { error: `A phrase can be ${MAX_PHRASE} characters at most.` };
    if (!phraseKey(t)) return { error: 'A phrase needs some words.' };
    if (phrases.some(x => phraseKey(x) === phraseKey(t))) continue;
    phrases.push(t);
  }
  if (phrases.length > MAX_PHRASES) return { error: `A routine can have ${MAX_PHRASES} phrases at most.` };
  if (!Array.isArray(r.steps) || !r.steps.length) return { error: 'Add at least one step.' };
  if (r.steps.length > MAX_STEPS) return { error: `A routine can have ${MAX_STEPS} steps at most.` };
  const steps: Step[] = [];
  for (const s of r.steps) {
    const c = cleanStep(s);
    if ('error' in c) return c;
    steps.push(c);
  }
  const at = cleanTime(r.at);
  if (at && 'error' in at) return at;
  return { name, phrases, steps, ...(at ? { at } : {}) };
}

/** Find a routine by its id or its name ("Good morning", "the good morning routine"). */
export function findRoutine<T extends { id: string; name: string }>(list: T[], ref: unknown): T | undefined {
  if (typeof ref !== 'string') return undefined;
  const want = phraseKey(ref).replace(/^(?:the|my|our) /, '').replace(/ routine$/, '');
  if (!want) return undefined;
  return list.find(r => r.id === ref) ?? list.find(r => phraseKey(r.name) === want);
}

/** "Weather", "Say “Good night”", "Timer, 5 minutes": one line for a step (the page and Claude's tool use it). */
export function stepLabel(s: Step, sceneName?: string): string {
  switch (s.kind) {
    case 'weather': return 'Say the weather';
    case 'calendar': return 'Read today’s calendar';
    case 'say': return `Say “${s.text}”`;
    case 'scene': return `Set the scene ${sceneName || s.entity_id}`;
    case 'timer': return `Start a ${s.minutes}-minute timer`;
    case 'pause': return `Pause ${s.seconds} second${s.seconds === 1 ? '' : 's'}`;
    case 'lists': return `Read the ${s.list === 'todo' ? 'to-do' : s.list === 'shopping' ? 'shopping' : s.list.replace(/-/g, ' ')} list`;
    case 'quiet': return s.on ? 'Turn Do Not Disturb on' : 'Turn Do Not Disturb off';
    case 'ambient': return 'Show the screen saver';
    case 'focus': return `Turn on ${FOCUS_NAMES[s.mode]} focus`;
    case 'radio': return 'Play the last radio station';
  }
}
