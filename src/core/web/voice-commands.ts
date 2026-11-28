// Quick voice commands, handled on the spot without starting a Claude session.
//
// After "Hey Claude", the Claude app's voice.ts first offers what you said to `runCommand`. If it is
// clearly one of these, it's done here and answered aloud; anything else (or anything unclear) is
// left alone and goes to Claude as before. Matching is strict on purpose: whole phrases only.
//
//   Timers   "set a timer for 10 minutes", "five minute timer", "a minute and a half timer",
//            "cancel the timer", "how long is left"
//   Stopwatch "start the stopwatch" (starts or resumes it), "stop the stopwatch" (pauses it while it runs),
//   "how long is the stopwatch" (says its time), "reset the stopwatch" (clears it)
//   Alarms   "wake me up at 7", "set an alarm for 6:30 on weekdays", "alarm for half past six",
//            "turn off my alarms", "when is my alarm"
//   Weather  "what's the weather", "what's the weather tomorrow", "will it rain (today/tomorrow)"
//   Radio    "play the radio" (the last station), "stop the radio" (pauses what is playing)
//   Time     "what time is it", "what's the date", "what day is it"
//   Screen   "dim the screen", "brighter", "brightness 50 percent", "dark mode", "light mode"
//   Sound    "volume up/down", "louder", "quieter", "mute", "volume 30 percent"
//   Apps     "open photos", "show the calendar", "go to home assistant", "open the settings app", "go home"
//            (exactly one app name; see voice-open.ts)
//   Home     "turn off the kitchen light", "lights on", "switch on the fan" (dashboard devices only; see
//            apps/home-assistant/web/voice-match.ts); "set movie night", "activate good morning" (scenes)
//   Lists    "add milk to the shopping list", "put bin day on my to-do list", "what's on the shopping list",
//            "change milk to oat milk"
//            (Shopping and To-do only; see apps/lists/web/voice-match.ts)
//   Calendar "what's on today", "what's on my calendar": the next three events today (read-only);
//            "what's on tomorrow": the first three events tomorrow
//   Routines any phrase a routine has ("good morning"), "run the good night routine", "start good morning",
//            "good night routine" (apps/routines: the Routines app speaks each step itself)
//
// The Clock app provides timers and alarms (provideClock), the Routines app its routines (provideRoutines);
// the rest uses core only.
import { getJson, postJson, store } from './dom.ts';
import type { HaDashboard, HaResult, HaScenes } from '../../apps/home-assistant/api.ts';
// a quick command the PC never answers gives up, so the voice still says it cannot reach the PC
const READ_TIMEOUT_MS = 20e3;
import { matchHome, matchScene, onOffReply, parseOnOff, parseScene, sayName, type VoiceDevice } from '../../apps/home-assistant/web/voice-match.ts';
import type { CalEvent, CalEvents } from '../../apps/calendar/api.ts';
import { isBuiltIn, type ListsResult } from '../../apps/lists/api.ts';
import { matchList } from '../../apps/lists/web/voice-match.ts';
import { sceneFailText } from '../../apps/home/web/scene-words.ts';
import { device, onTablet } from './device.ts';
import { openApp, prefs, sleep } from './system.ts';
import { sleepWord } from './voice-sleep.ts';
import { alarmTimePhrase, alarmWord, timerWord } from './voice-alarm.ts';
import { temperatureDay, weatherTrouble } from './voice-weather.ts';
import { radioStopHeard, radioWord } from './voice-radio.ts';
import { stopwatchWord } from './voice-stopwatch.ts';
import { dinnerSay, dinnerWord } from './voice-dinner.ts';
import { dinnersIn, isoDay } from '../../apps/meals/web/week.ts';
import { mediaState, pauseMedia } from './media.ts';
import { addManyReply, findExact, pickItem } from '../../apps/lists/web/voice-match.ts';
import { isQueued, readLists, writeList } from '../../apps/lists/web/readers.ts';
import { durationAndLabel, labelledTimer, parseDuration, parseTime, parseDays, DAY_WORDS, daysText, morningDays, namedTimerReply, resolveHour, sayDuration, type TimeOfDay } from './voice-parse.ts';
import { setThemeMode } from './theme.ts';
import { matchOpenApp } from './voice-open.ts';

export interface ClockApi {
  /** label: shown when it rings (Claude's set_timer); the Clock's own controls set none. */
  startTimer(ms: number, label?: string): boolean;   // false when the timer list is full
  cancelTimer(): boolean;
  /** Cancel every timer in the list. Returns how many there were. */
  cancelAllTimers(): number;
  /** Cancel the timer with this label (its name, any case). False when there is none. */
  cancelNamedTimer(label: string): boolean;
  /** Start the stopwatch (true) or stop it (false). False when it is already that way. */
  stopwatch(start: boolean): boolean;
  stopwatchRunning(): boolean;
  /** The stopwatch's time in ms, paused or running. */
  stopwatchTime(): number;
  /** Clear the stopwatch: stop it and drop its time and laps. */
  stopwatchReset(): void;
  /** Pause a running timer. False when none runs. */
  pauseTimer(): boolean;
  /** Resume a paused timer. False when none is paused. */
  resumeTimer(): boolean;
  /** Add (positive) or take off (negative) whole minutes. False when no timer is set. */
  nudgeTimer(minutes: number): boolean;
  timerLeft(): number | null;
  /** True when the timer the voice means is paused (its time stays where it was). */
  timerPaused(): boolean;
  addAlarm(h: number, m: number, days: number[]): { when: string; at: number } | null;
  /** A new one-off alarm with a label (Claude's set_alarm and set_reminder); never changes an alarm already there.
   *  null when the Clock's list is full. */
  /** days: repeat on these (Date.getDay values); none means once. */
  addLabelled(h: number, m: number, label: string, days?: number[]): { when: string; at: number } | null;
  /** Timers and alarms switched on (a running or paused timer counts as one). */
  active(): number;
  alarmsOff(): number;
  /** Switch off the alarm at one time (it stays in the list). Returns how many were on. */
  switchOffAlarm(h: number, m: number): number;
  /** The ring now: 'alarm' or 'timer', null when nothing rings. */
  ringing(): 'alarm' | 'timer' | null;
  /** Silence and dismiss the ring. False when nothing rings. */
  stopRinging(): boolean;
  /** Snooze a ringing alarm. False when nothing rings or a timer does. */
  snoozeRinging(): boolean;
  /** Switch off only the alarms and reminders Claude set (they stay in the list). Returns how many were on. */
  cancelClaudeAlarms(): number;
  nextAlarm(): { h: number; m: number; when: string } | null;
}
let clock: ClockApi | null = null;
export function provideClock(api: ClockApi): void { clock = api; }
/** The Clock's timers and alarms, for Claude's tablet tools (apps/claude/web/browser-relay.ts); null until it mounts. */
export const getClock = (): ClockApi | null => clock;

/** The Routines app (apps/routines/web/run.ts): its routines (cached there) and its runner, which speaks each step
 *  itself. Provided when that app's module loads; null without it, and then no phrase is a routine. */
export interface RoutineRef { id: string; name: string; phrases: string[] }
export interface RoutinesApi {
  list(): Promise<RoutineRef[]>;
  /** Start a routine by id, or say why not: 'gone' (no such routine), 'empty' (no steps), 'offline' (the PC did
   *  not answer and no copy is recent). Returns at once: the steps run on their own. */
  run(id: string): Promise<'started' | 'gone' | 'empty' | 'offline'>;
  /** The id of the routine that runs now, or null. A phrase for that one says it is running, rather than starting it again. */
  running(): string | null;
}
let routines: RoutinesApi | null = null;
export function provideRoutines(api: RoutinesApi): void { routines = api; }
export const getRoutines = (): RoutinesApi | null => routines;

/** What a command did: the words to say (also shown; '' when the command speaks for itself, as a routine does),
 *  and how the critter might react. */
export interface CommandResult { say: string; react?: 'hop' | 'love' | 'wave' | 'look'; app?: string }

// ---------- words → numbers ----------
const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Lower-case, no punctuation, number words as digits ("twenty five" → "25", "a hundred" → "100"). */
function normalise(s: string): string {
  let t = ` ${s.toLowerCase().replace(/(\d):(\d\d)/g, '$1 $2').replace(/[’']/g, "'").replace(/[^a-z0-9.' ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  // speech often drops the apostrophe: "whats the time" is "what's the time"
  t = t.replace(/ (what|when|how)s(?= )/g, ' $1\'s');
  t = t.replace(/ (a|one) hundred /g, ' 100 ');
  t = t.replace(new RegExp(` (${Object.keys(TENS).join('|')})(?:[ -](${Object.keys(UNITS).filter(k => UNITS[k] > 0 && UNITS[k] < 10).join('|')}))? `, 'g'),
    (_m, a: string, b?: string) => ` ${TENS[a] + (b ? UNITS[b] : 0)} `);
  t = t.replace(/ ([a-z]+)(?= )/g, (m, w: string) => (w in UNITS && w !== 'oh' ? ` ${UNITS[w]}` : m));
  return t.replace(/\s+/g, ' ').trim();
}

// ---------- durations ----------
/** "10 minutes", "1 hour and 30 minutes", "a minute and a half", "half an hour", "90 seconds" → ms; null if not exactly that. */

// ---------- times of day ----------


const clockText = (h: number, m: number) => new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/^0/, '');

// ---------- weather ----------
interface Wx {
  status: string; units?: string; place?: string | null; city?: string;
  current?: { temperature_2m: number; weather_code: number };
  daily?: { weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] };
}
function sky(code: number): string {
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly cloudy';
  if (code === 3) return 'cloudy';
  if (code <= 48) return 'foggy';
  if (code <= 57) return 'drizzly';
  if (code <= 67) return 'rainy';
  if (code <= 77) return 'snowy';
  if (code <= 82) return 'showery';
  if (code <= 86) return 'snow showers';
  return 'stormy';
}
const deg = (n: number) => `${Math.round(n)} degrees`;

/** Today's weather, as "what's the weather" answers it (a routine's weather step speaks the same words). */
export const weatherToday = (): Promise<CommandResult> => weather(0, null);

async function weather(day: 0 | 1, rainOnly: 'rain' | 'snow' | null): Promise<CommandResult> {
  let w: Wx;
  try { w = await getJson<Wx>('/api/weather/forecast', READ_TIMEOUT_MS); } catch { return weatherTrouble(null)!; }
  if (w.status === 'no_location') return { say: 'Weather needs a place first. Set it in the Weather app.', app: 'weather' };
  if (w.status !== 'ok' || !w.daily) return weatherTrouble(w) ?? { say: 'I can’t get the weather right now.' };
  const d = w.daily, when = day ? 'tomorrow' : 'today';
  const chance = d.precipitation_probability_max[day] ?? 0, code = d.weather_code[day];
  if (rainOnly) {
    const snowy = code >= 71 && code <= 86;
    const wet = rainOnly === 'snow' ? snowy : !snowy;
    if (chance >= 60 && wet) return { say: `Yes, ${rainOnly} looks likely ${when}: a ${chance} percent chance.`, react: 'look' };
    if (chance >= 30) return { say: `Maybe. There's a ${chance} percent chance of ${snowy ? 'snow' : 'rain'} ${when}.`, react: 'look' };
    return { say: `Probably not. Only a ${chance} percent chance of ${snowy ? 'snow' : 'rain'} ${when}.`, react: 'hop' };
  }
  const hi = d.temperature_2m_max[day], lo = d.temperature_2m_min[day];
  const rain = chance >= 30 ? ` with a ${chance} percent chance of ${code >= 71 && code <= 86 ? 'snow' : 'rain'}` : '';
  if (!day && w.current) {
    return { say: `It's ${deg(w.current.temperature_2m)} and ${sky(w.current.weather_code)}${w.place ? ` in ${w.place.split(',')[0]}` : ''}. Today, a high of ${deg(hi)} and a low of ${deg(lo)}${rain}.`, react: 'look' };
  }
  return { say: `Tomorrow looks ${sky(code)}, with a high of ${deg(hi)} and a low of ${deg(lo)}${rain}.`, react: 'look' };
}

// ---------- screen, sound, theme, apps ----------
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const pct = (v: number) => `${Math.round(v * 100)} percent`;

function brightness(to: number | 'up' | 'down'): CommandResult {
  if (!onTablet) return { say: 'I can only change the screen on the tablet.' };
  const cur = prefs.brightness;
  const v = to === 'up' ? clamp(cur + .25, .05) : to === 'down' ? clamp(cur - .25, .05) : clamp(to, .05);
  prefs.brightness = v;
  return { say: to === 'up' ? (v >= 1 ? 'That’s as bright as it goes.' : 'Brighter.') : to === 'down' ? (v <= .05 ? 'That’s as dim as it goes.' : 'Dimmer.') : `Brightness ${pct(v)}.` };
}

function volume(to: number | 'up' | 'down' | 'mute' | 'unmute'): CommandResult {
  if (!onTablet) return { say: 'I can only change the volume on the tablet.' };
  let cur = 0;
  try { cur = device.volume().media; } catch { return { say: 'I can’t change the volume right now.' }; }
  const v = to === 'up' ? clamp(cur + .15) : to === 'down' ? clamp(cur - .15) : to === 'mute' ? 0 : to === 'unmute' ? (cur > 0 ? cur : .5) : clamp(to);
  try { device.setVolume('media', v); } catch { return { say: 'I can’t change the volume right now.' }; }
  if (v === 0) return { say: 'Muted.' };   // (only shown: there's nothing to hear it with)
  return { say: to === 'up' ? (v >= 1 ? 'That’s as loud as it goes.' : 'Louder.') : to === 'down' ? 'Quieter.' : `Volume ${pct(v)}.` };
}

/** "open photos", "show the calendar", "go to home assistant" (core/web/voice-open.ts). An app this screen doesn't
 *  have (Camera, Browser and Settings are tablet-only, as on the Apps screen) is not opened: null, and the phrase goes on. */
function open(t: string): CommandResult | null {
  const app = matchOpenApp(t);
  if (!app || !document.querySelector(`.ri[data-app="${app.id}"]`)) return null;
  openApp(app.id);
  return { say: `Opening ${app.name}.`, react: 'hop', app: app.id };
}

// ---------- the commands ----------
const POLITE = /^(?:(?:can|could|would|will) you |please |hey |ok |okay |claude )+|(?: please| thanks| thank you)+$/g;

/** Run what was said if it's a quick command; null means "not one of mine, ask Claude". */
export async function runCommand(raw: string): Promise<CommandResult | null> {
  const t = normalise(raw).replace(POLITE, '').trim().replace(POLITE, '').trim();
  let r: RegExpMatchArray | null;

  // routines first: a phrase the family gave a routine is theirs ("good morning"), then "run the <name> routine"
  const routine = await routineCommand(t);
  if (routine) return routine;

  // calendar: "what's on today", "what's on my calendar" (before the lists, so "what's on ..." is ours)
  if (/^(?:what(?:'s|s| is) on (?:for )?(?:today|(?:my|the) calendar(?: today| for today)?|today'?s calendar)|what do i have on today)$/.test(t)) return calendarCommand();
  if (/^(?:what(?:'s|s| is) on (?:for )?tomorrow|what(?:'s|s| is) on (?:my|the) calendar (?:for )?tomorrow|what do i have (?:on )?tomorrow)$/.test(t)) return calendarCommand('tomorrow');
  const dinner = dinnerWord(t);   // "what's for dinner tonight": the Meals dinner the calendar holds for that night
  if (dinner) return dinnerCommand(dinner);

  // lists: "add milk to the shopping list" (the words as said, not normalised: "two" stays "two")
  // the family's own lists are heard by name too; the lists are read only when the words mention a list
  const customs = /\blist\b/.test(t) ? await voiceCustomLists() : [];
  const list = matchList(raw, customs);
  if (list?.op === 'edit' && list.list === null) {
    // "change milk to oat milk" with no list said: only an item with exactly those words; else the phrase goes on (timers, Claude...)
    const r = await editAnywhere(list.text, list.to);
    if (r) return r;
  } else if (list) return listCommand(list, customs.find(c => c.id === list.list)?.name);

  // stopwatch: start it, or stop it only while it runs (a stop when none runs is left to Claude)
  const sws = stopwatchWord(t);
  if (sws && clock) {
    if (sws === 'time') {
      const ms = clock.stopwatchTime();
      return { say: ms < 1000 ? 'The stopwatch is at zero.' : `The stopwatch says ${sayDuration(Math.floor(ms / 1000) * 1000)}.` };
    }
    if (sws === 'reset') { clock.stopwatchReset(); return { say: 'Stopwatch reset.' }; }
    // starts it with no spoken reply (the tablet's own tap says "and... go!"); when it already runs, say so
    if (sws === 'start') return clock.stopwatch(true) ? { say: '' } : { say: 'The stopwatch is already running.' };
    if (clock.stopwatchRunning()) { clock.stopwatch(false); return { say: 'Stopped.' }; }
  }
  // timers: the first of these shapes whose duration parses wins
  for (const re of [/^(?:set|start|make|put on|give me)(?: me)?(?: a| an| the)? timer (?:for |of )?(.+)$/, /^timer (?:for )?(.+)$/,
    /^(?:set |start )?(?:a |an )?(.+?) timer$/]) {
    const m = t.match(re);
    const ms = m ? parseDuration(m[1].replace(/^(a|an) (?=\d)/, '')) : null;
    if (ms == null) continue;
    if (!clock) return { say: 'The clock isn’t ready yet. Try again in a moment.' };
    // a new timer joins the list; any timer already running keeps going
    if (!clock.startTimer(ms)) return { say: 'The timer list is full. Stop a timer first.' };
    return { say: `Timer set for ${sayDuration(ms)}.`, react: 'hop' };
  }
  // alarms: "stop" silences a ringing one; only "all my alarms" switches every alarm off (core/web/voice-alarm.ts)
  if (clock) {
    const word = alarmWord(t, clock.ringing() !== null);
    if (word === 'stop-ring') { clock.stopRinging(); return { say: 'Stopped.', react: 'look' }; }
    if (word === 'snooze') return clock.snoozeRinging() ? { say: 'Okay. Nine more minutes.', react: 'hop' } : { say: 'Snooze is for alarms. Say stop for the timer.' };
    if (word === 'all-off') { const n = clock.alarmsOff(); return { say: n ? `Okay, ${n === 1 ? 'your alarm is' : `all ${n} alarms are`} off.` : 'You don’t have any alarms on.', react: 'look' }; }
    // "turn off my 7 am alarm": that one alarm (it stays in the list); the time is read the same way as when setting one
    const phrase = word === null ? alarmTimePhrase(t) : null;
    const tod = phrase ? parseTime(phrase) : null;
    if (tod) {
      const { h, m } = resolveHour(tod, false);
      const n = clock.switchOffAlarm(h, m);
      return { say: n ? `Okay, your ${clockText(h, m)} alarm is off.` : `You don’t have an alarm at ${clockText(h, m)}.` };
    }
    if (word === 'one-alarm') return { say: 'Nothing is ringing. To switch them all off, say turn off all my alarms.' };
  }
  // a named timer: "set a 10 minute pasta timer" starts 10 minutes, labelled pasta (shown when it rings)
  const named = t.match(/^(?:set |start )?(?:a |an )?(.+?) timer$/);
  // the label can also come first: "set a pasta timer for 10 minutes", "set a 10 minute timer for the pasta" (voice-parse.ts)
  const dl = (named ? durationAndLabel(named[1].replace(/^(a|an) (?=\d)/, '')) : null) ?? labelledTimer(t);
  if (dl) {
    if (!clock) return { say: 'The clock isn’t ready yet. Try again in a moment.' };
    if (!clock.startTimer(dl.ms, dl.label)) return { say: 'The timer list is full. Stop a timer first.' };
    return { say: namedTimerReply(dl.label, dl.ms), react: 'hop' };
  }
  // timer: pause, resume, add or take off minutes (core/web/voice-alarm.ts)
  const tw = timerWord(t);
  if (tw && clock) {
    // a timer that is already paused (or already running) says so, rather than "no timer running" (or "no paused timer")
    if (tw.op === 'pause') {
      if (clock.pauseTimer()) return { say: 'Timer paused.', react: 'look' };
      return clock.timerPaused() ? { say: 'The timer is already paused.', react: 'look' } : { say: 'There’s no timer running.' };
    }
    if (tw.op === 'resume') {
      if (clock.resumeTimer()) return { say: 'Timer resumed.', react: 'hop' };
      return clock.timerLeft() != null && !clock.timerPaused() ? { say: 'The timer is already running.', react: 'look' } : { say: 'There’s no paused timer.' };
    }
    if (tw.op === 'cancel-named') {
      const shown = tw.label.charAt(0).toUpperCase() + tw.label.slice(1);
      return clock.cancelNamedTimer(tw.label) ? { say: `${shown} timer cancelled.`, react: 'look' } : { say: `You don’t have a ${tw.label} timer.`, react: 'look' };
    }
    if (tw.op === 'cancel-all') {
      const n = clock.cancelAllTimers();
      return n ? { say: n === 1 ? 'Timer cancelled.' : `All ${n} timers cancelled.`, react: 'look' } : { say: 'There’s no timer running.', react: 'look' };
    }
    if (!clock.nudgeTimer(tw.minutes)) return { say: 'There’s no timer running.' };
    const n = Math.abs(tw.minutes);
    return { say: tw.minutes > 0 ? `Added ${n} minute${n === 1 ? '' : 's'}.` : `Took off ${n} minute${n === 1 ? '' : 's'}.`, react: 'hop' };
  }
  if (/^(?:cancel|stop|delete|clear|end|reset|kill|turn off)(?: the| my)? timer$/.test(t)) {
    if (!clock) return null;
    return { say: clock.cancelTimer() ? 'Timer cancelled.' : 'There’s no timer running.', react: 'look' };
  }
  if (/^(?:how (?:much time|long)(?:'s| is)? (?:left|remaining|to go)(?: on (?:the|my) timer)?|(?:how'?s|how is) (?:the|my) timer(?: doing)?|time left(?: on (?:the|my) timer)?)$/.test(t)) {
    if (!clock) return null;
    const left = clock.timerLeft();
    // a paused timer's time does not count down: say so, rather than read it like a running one
    const paused = clock.timerPaused();
    return { say: left == null ? 'There’s no timer running.' : `${sayDuration(Math.ceil(left / 1000) * 1000)} left${paused ? ', and the timer is paused' : ''}.`.replace(/^./, c => c.toUpperCase()) };
  }

  if (/^(?:when(?:'s| is) my (?:next )?alarm|what time(?:'s| is) my alarm|is my alarm (?:on|set)|do i have an alarm(?: set)?)$/.test(t)) {
    if (!clock) return null;
    const n = clock.nextAlarm();
    return { say: n ? `Your next alarm is ${clockText(n.h, n.m)} ${n.when}.` : 'You don’t have any alarms on.' };
  }
  if ((r = t.match(/^(?:(?:set|make|add|create)(?: me)?(?: an| the| my| a)? alarm (?:for |at )?|wake me(?: up)? (?:at )?|alarm (?:for |at )?)(.+)$/))) {
    const wakeUp = /^wake/.test(t);
    // split "<time> <days>" at the first word that starts a days phrase
    const m = r[1].match(/^(.+?)(?: ((?:on|every|each|for) .+|tomorrow.*|daily|weekdays|weekends))?$/);
    if (!m) return null;
    const time = parseTime(m[1]), days = parseDays(m[2] || '');
    if (!time || days == null) return null;   // not sure: let Claude sort it out
    if (!clock) return { say: 'The clock isn’t ready yet. Try again in a moment.' };
    const { h, m: mins } = resolveHour(time, wakeUp || days.length > 0 || morningDays(m[2] || ''));
    const set = clock.addAlarm(h, mins, days);
    if (!set) return { say: 'You have too many alarms. Delete one in the Clock first.', app: 'clock' };
    return { say: `Alarm set for ${clockText(h, mins)}${days.length ? daysText(days) : ` ${set.when}`}.`, react: 'hop' };
  }

  // time and date
  if (/^(?:what(?:'s| is) the time(?: now| right now)?|what time is it(?: now| right now)?|(?:tell me )?the time|time)$/.test(t)) {
    return { say: `It's ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` };
  }
  if (/^(?:what(?:'s| is) (?:the date|today'?s date|the date today)|what day is (?:it|today)(?: today)?|what(?:'s| is) today)$/.test(t)) {
    return { say: `It's ${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}.` };
  }

  // weather
  const tempDay = temperatureDay(t);
  if (tempDay !== null) return weather(tempDay, null);
  if (/^(?:what(?:'s| is| will be) the weather(?: like)?(?: today| now| right now| outside)?|how(?:'s| is) the weather(?: today)?|weather(?: today)?|what(?:'s| is) it like outside|what(?:'s| is) the forecast(?: today)?)$/.test(t)) return weather(0, null);
  if (/^(?:what(?:'s| is| will be) the weather(?: like)? tomorrow|what(?:'s| is) the forecast (?:for )?tomorrow|weather tomorrow|how(?:'s| is| will) the weather (?:be )?tomorrow)$/.test(t)) return weather(1, null);
  if ((r = t.match(/^(?:will it|is it going to|is it gonna|should i expect|do i need an umbrella|is there going to be)(?: (rain|snow))?(?: (today|tomorrow|later|tonight))?$/))) {
    if (!r[1] && !/umbrella/.test(t)) return null;
    return weather(r[2] === 'tomorrow' ? 1 : 0, (r[1] as 'rain' | 'snow') || 'rain');
  }

  // "go to sleep": the clock screen, after the spoken "Okay." has finished (the same as the Control Center's Rest now tile)
  if (sleepWord(t)) { setTimeout(sleep, 1200); return { say: 'Okay.', react: 'look' }; }
  // screen
  if (/^(?:dim|jim|darken)(?: the)? screen$|^(?:make|turn)(?: the)? (?:screen|it) (?:dimmer|darker|down)$|^(?:turn|bring)(?: the)? brightness down$|^dimmer$|^(?:screen )?darker$|^lower(?: the)? brightness$/.test(t)) return brightness('down');
  if (/^(?:brighten|light up)(?: the)? screen$|^(?:make|turn)(?: the)? (?:screen|it) (?:brighter|up)$|^(?:turn|bring)(?: the)? brightness up$|^(?:screen )?brighter$|^raise(?: the)? brightness$/.test(t)) return brightness('up');
  if (/^(?:full|max|maximum) brightness$/.test(t)) return brightness(1);
  if ((r = t.match(/^(?:set )?(?:the )?brightness (?:to )?(\d{1,3})(?: percent| %)?$/))) return +r[1] <= 100 ? brightness(+r[1] / 100) : null;
  if (/^(?:turn on |switch to |go |use |enable )?(?:the )?(?:dark|night) (?:mode|theme)$|^(?:turn off|disable)(?: the)? light (?:mode|theme)$/.test(t)) { setThemeMode('dark'); return { say: 'Dark mode.', react: 'look' }; }
  if (/^(?:turn on |switch to |go |use |enable )?(?:the )?(?:light|day) (?:mode|theme)$|^(?:turn off|disable)(?: the)? (?:dark|night) (?:mode|theme)$/.test(t)) { setThemeMode('light'); return { say: 'Light mode.', react: 'hop' }; }

  // radio: play the last station the Radio app kept, or pause what is playing (a stop when nothing plays is not heard)
  const radio = radioWord(t);
  if (radio === 'play') {
    let last: unknown[] = [];
    try { last = JSON.parse(store.get('radio.recent') || '[]') as unknown[]; } catch { /* none kept */ }
    if (!last.length) return { say: 'No radio station has played yet.' };
    dispatchEvent(new CustomEvent('hub:radio-last'));
    return { say: '' };
  }
  if (radio === 'stop' && radioStopHeard(mediaState())) { pauseMedia(); return { say: 'Stopped.' }; }
  // sound
  if (/^(?:turn |turn it |turn the volume |volume |sound )?up$|^louder$|^(?:turn|make)(?: it| the volume| the sound)? louder$|^(?:raise|increase)(?: the)? volume$/.test(t) && /up|loud|raise|increase/.test(t)) return volume('up');
  if (/^(?:turn |turn it |turn the volume |volume |sound )?down$|^quieter$|^(?:turn|make)(?: it| the volume| the sound)? quieter$|^(?:lower|decrease|reduce)(?: the)? volume$/.test(t) && /down|quiet|lower|decrease|reduce/.test(t)) return volume('down');
  if (/^(?:mute|silence)(?: the)?(?: sound| volume| tablet)?$/.test(t)) return volume('mute');
  if (/^unmute(?: the)?(?: sound| volume| tablet)?$/.test(t)) return volume('unmute');
  if ((r = t.match(/^(?:set )?(?:the )?volume (?:to )?(\d{1,3})(?: percent| %)?$/))) return +r[1] <= 100 ? volume(+r[1] / 100) : null;

  // apps
  // exactly one app name, else the phrase goes on ("open the lights" is Home Assistant's)
  const opened = open(t);
  if (opened) return opened;

  // Home Assistant on/off, then scenes: last, so "turn off the timer" / "set a timer" are still the ones above
  return (await homeOnOff(raw)) ?? sceneCommand(raw);
}

// ---------- Routines: "good morning", "run the good night routine", "start good morning" ----------
/** A routine's own phrases match the whole sentence; its name matches after "run"/"start" (with or without
 *  "routine"), or before "routine" ("good night routine", "do the good night routine"). Anything else: null. */
async function routineCommand(t: string): Promise<CommandResult | null> {
  if (!routines) return null;
  let list: RoutineRef[];
  try { list = await routines.list(); } catch { return null; }
  if (!list.length) return null;
  const key = (s: string) => normalise(s).replace(/'/g, '');
  const said = t.replace(/'/g, '');
  let hit = list.find(x => x.phrases.some(p => key(p) === said));
  if (!hit) {
    const m = said.match(/^(?:run|start)(?: the| my)? (.+?)(?: routine)?$/) ?? said.match(/^(?:(?:do|begin|play|trigger)(?: the| my)? )?(?:the |my )?(.+?) routine$/);
    if (m) hit = list.find(x => key(x.name) === m[1]);
  }
  if (!hit) return null;
  if (routines.running() === hit.id) return { say: `${hit.name} is already running.`, react: 'look' };
  const res = await routines.run(hit.id);
  if (res === 'started') return { say: '', react: 'hop' };   // the routine speaks each step itself
  // the same words as the Routines app's Run button (run.ts StartResult)
  if (res === 'empty') return { say: 'That routine has no steps yet.' };
  if (res === 'offline') return { say: 'The PC isn’t answering, so that routine can’t start.' };
  return null;   // gone: the phrase goes on to Claude as before
}

// ---------- Home Assistant scenes: "set movie night", "activate good morning" ----------
/** Only scenes on the Home Assistant dashboard or on the Home screen (the PC checks it again); no match means null. */
async function sceneCommand(raw: string): Promise<CommandResult | null> {
  if (!parseScene(raw)) return null;   // not a "set / activate <scene>" phrase: don't ask the PC at all
  let list: HaScenes;
  try { list = await getJson<HaScenes>('/api/home-assistant/scenes', READ_TIMEOUT_MS); } catch { return null; }
  if (list?.status !== 'ok' || !Array.isArray(list.scenes)) return null;
  const m = matchScene(raw, list.scenes.filter(s => s.dashboard || s.home));
  if (!m) return null;
  // r stays null when the PC does not answer, so the say line can tell "no answer" from "the PC refused"
  let r: HaResult | null = null;
  try { r = await postJson<HaResult>('/api/home-assistant/scene', { entity_id: m.entity_id }, READ_TIMEOUT_MS); } catch { r = null; }
  return r?.ok ? { say: `${m.name} is on.`, react: 'hop' } : { say: sceneFailText(m.name, r) };
}

// ---------- Calendar: "what's on today", "what's on my calendar" ----------
/** The Meals dinner on a night, read from the calendar's "Dinner: …" events (the same events Home's Tonight row reads). */
async function dinnerCommand(night: 'tonight' | 'tomorrow'): Promise<CommandResult> {
  const d = new Date();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (night === 'tomorrow' ? 1 : 0));
  const from = isoDay(day), to = isoDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1));
  let r: { status?: string; events?: { id: string; title: string; start: number; end: number; allDay: boolean }[] };
  try { r = await getJson(`/api/calendar/local?from=${from}&to=${to}`, READ_TIMEOUT_MS); }
  catch { return { say: 'I can’t reach the calendar right now.' }; }
  if (r?.status !== 'ok') return { say: 'I can’t reach the calendar right now.' };
  const hit = dinnersIn(r.events ?? []).find(x => x.start === day.getTime());
  return { say: dinnerSay(hit?.text ?? null, night), react: 'look', app: 'meals' };
}

/** The next three events still to come today, read aloud (the Calendar app's own route, GET /api/calendar/events). */
export async function calendarCommand(day: 'today' | 'tomorrow' = 'today', cachedOnly = false): Promise<CommandResult> {
  let r: CalEvents;
  try { r = await getJson<CalEvents>('/api/calendar/events', READ_TIMEOUT_MS); } catch { return { say: 'I can’t reach your PC right now.' }; }
  // no calendar address set: the claude.ai calendar connector answers instead (the PC's cached read)
  if (r?.status === 'not_set') return connectorCommand(day, cachedOnly);
  if (r?.status !== 'ok' || !Array.isArray(r.events)) return { say: 'I can’t read the calendar right now.' };
  // the PC serves its last good copy when a read fails (up to 12 hours old): say so, never read it as current
  const old = r.stale ? 'The calendar may be out of date. ' : '';
  const at = (e: CalEvent) => (e.allDay ? `${e.title}, all day` : `${e.title} at ${new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  if (day === 'tomorrow') {
    const tmr = r.events.filter(e => e.day === 'tomorrow').slice(0, 3).map(at);
    if (!tmr.length) return { say: `${old}Nothing on your calendar tomorrow.`, react: 'hop' };
    const w = tmr.length === 1 ? tmr[0] : `${tmr.slice(0, -1).join('; ')}; and ${tmr[tmr.length - 1]}`;
    return { say: `${old}Tomorrow: ${w}.`, react: 'look', app: 'calendar' };
  }
  const now = Date.now();
  const next = r.events.filter(e => e.day === 'today' && Date.parse(e.end) > now).slice(0, 3).map(at);
  if (!next.length) {
    const tmr = r.events.find(e => e.day === 'tomorrow');
    return { say: `${old}Nothing more on your calendar today.${tmr ? ` Tomorrow starts with ${at(tmr)}.` : ''}`, react: 'hop' };
  }
  const words = next.length === 1 ? next[0] : `${next.slice(0, -1).join('; ')}; and ${next[next.length - 1]}`;
  return { say: `${old}${next.length === 1 ? 'Next up' : 'Coming up'}: ${words}.`, react: 'look', app: 'calendar' };
}

// ---------- Lists: "add milk to the shopping list", "what's on the to-do list" ----------
/** Writes use the same routes as the Lists app's taps (POST /api/lists/add and the rest); the PC checks them. Reads use the tablet's copy (readLists). */
/** Today's or tomorrow's events from the claude.ai calendar connector (GET /api/calendar/connector), read aloud. */
async function connectorCommand(day: 'today' | 'tomorrow', cachedOnly = false): Promise<CommandResult> {
  type Ev = { title: string; start: number; end: number; allDay: boolean };
  let r: { status?: string; events?: Ev[] };
  try { r = await getJson<{ status?: string; events?: Ev[] }>(`/api/calendar/connector?day=${day}${cachedOnly ? '&cached=1' : ''}`); } catch { return { say: 'I can’t reach your PC right now.' }; }
  // a routine must not start a Claude read: with nothing cached it says so instead
  if (r?.status === 'miss') return { say: 'I haven’t read the calendar yet today.' };
  if (r?.status !== 'ok' || !Array.isArray(r.events)) return { say: 'I can’t read the calendar right now.' };
  const at = (e: Ev) => (e.allDay ? `${e.title}, all day` : `${e.title} at ${new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  const now = Date.now();
  const shown = (day === 'today' ? r.events.filter(e => e.end > now) : r.events).slice(0, 3).map(at);
  if (!shown.length) return { say: day === 'today' ? 'Nothing more on your calendar today.' : 'Nothing on your calendar tomorrow.', react: 'hop' };
  const words = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join('; ')}; and ${shown[shown.length - 1]}`;
  return { say: `${day === 'today' ? 'Coming up' : 'Tomorrow'}: ${words}.`, react: 'look', app: 'calendar' };
}

/** A write the PC could not take: writeList queued it on the tablet and threw queued: true. Any other error is rethrown,
 *  so the caller's catch says it can't reach the list. */
function queuedReply(e: unknown, said: string): CommandResult {
  if (!isQueued(e)) throw e;
  return { say: `${said} The PC will get it when it’s back.`, react: 'hop' };
}

/** The family's own tick-off lists (id and name), for voice. Shopping, To-do and Notes are not among them. */
async function voiceCustomLists(): Promise<{ id: string; name: string }[]> {
  try {
    const lists = await readLists(READ_TIMEOUT_MS);
    return lists.filter(l => !isBuiltIn(l.id)).map(l => ({ id: l.id, name: l.name }));
  } catch { return []; }
}

async function listCommand(c: NonNullable<ReturnType<typeof matchList>>, customName?: string): Promise<CommandResult> {
  const name = c.list === 'shopping' ? 'the shopping list' : c.list === 'todo' ? 'the to-do list' : spokenList(customName ?? 'list');
  try {
    if (c.op === 'add') {
      let r: ListsResult;
      try { r = await writeList('add', { list: c.list, text: c.text }); }
      catch (e) {
        // queued on the tablet (the PC is not answering): the same words as the comma form
        if (isQueued(e)) return { say: addManyReply([c.text], 0, 1, name), react: 'hop' };
        throw e;
      }
      if (!r?.ok) return { say: r?.error ?? `I couldn’t add that to ${name}.` };
      return { say: `Added ${c.text.replace(/^./, ch => ch.toLowerCase())} to ${name}.`, react: 'hop' };
    }
    if (c.op === 'tick') {
      // find the one unticked item by its words (exact, or the only partial match); never a guess between several
      const lists = await readLists(READ_TIMEOUT_MS);
      const l = lists.find(x => x.id === c.list);
      if (!l) return { say: `I can’t reach ${name} right now.` };
      const { hit, ambiguous } = pickItem(l.items, c.text, true);
      if (!hit) return { say: ambiguous ? `More than one item matches ${c.text} on ${name}. Say which one.` : `I can’t find ${c.text} on ${name}.` };
      let r: ListsResult;
      try { r = await writeList('tick', { list: c.list, id: hit.id, done: true }); }
      catch (e) { return queuedReply(e, `Ticked off ${hit.text.replace(/^./, ch => ch.toLowerCase())} on ${name}.`); }
      if (!r?.ok) return { say: r?.error ?? `I couldn’t tick that off ${name}.` };
      return { say: `Ticked off ${hit.text.replace(/^./, ch => ch.toLowerCase())} on ${name}.`, react: 'hop' };
    }
    if (c.op === 'addMany') {
      // one add per item, the same route the Lists app uses; the reply says what went on
      // a write the PC cannot take is queued on the tablet by writeList (and throws queued): the rest still go, and it is said.
      // Only a queued write counts as waiting; any other failure is neither added nor waiting.
      let ok = 0, waiting = 0;
      for (const text of c.texts) {
        try { const r = await writeList('add', { list: c.list, text }); if (r?.ok) ok++; }
        catch (e) { if (isQueued(e)) waiting++; }
      }
      if (!ok && !waiting) return { say: `I couldn’t add those to ${name}.` };
      return { say: addManyReply(c.texts, ok, waiting, name), react: 'hop' };
    }
    if (c.op === 'clear') {
      let r: ListsResult;
      try { r = await writeList('clear-done', { list: c.list }); }
      catch (e) { return queuedReply(e, `Cleared the ticked items on ${name}.`); }
      if (!r?.ok) return { say: r?.error ?? `I couldn’t clear ${name}.` };
      return { say: `Cleared the ticked items on ${name}.`, react: 'hop' };
    }
    if (c.op === 'remove') {
      // same rule as tick off: one item by its words, never a guess between several (open or ticked)
      const lists = await readLists(READ_TIMEOUT_MS);
      const l = lists.find(x => x.id === c.list);
      if (!l) return { say: `I can’t reach ${name} right now.` };
      const { hit, ambiguous } = pickItem(l.items, c.text, false);
      if (!hit) return { say: ambiguous ? `More than one item matches ${c.text} on ${name}. Say which one.` : `I can’t find ${c.text} on ${name}.` };
      let r: ListsResult;
      try { r = await writeList('remove', { list: c.list, id: hit.id }); }
      catch (e) { return queuedReply(e, `Removed ${hit.text.replace(/^./, ch => ch.toLowerCase())} from ${name}.`); }
      if (!r?.ok) return { say: r?.error ?? `I couldn’t remove that from ${name}.` };
      return { say: `Removed ${hit.text.replace(/^./, ch => ch.toLowerCase())} from ${name}.`, react: 'hop' };
    }
    if (c.op === 'has') {
      // read only: one item by its words (ticked or not), never a guess between several
      const lists = await readLists(READ_TIMEOUT_MS);
      const l = lists.find(x => x.id === c.list);
      if (!l) return { say: `I can’t reach ${name} right now.` };
      const { hit, ambiguous } = pickItem(l.items, c.text, false);
      if (ambiguous) return { say: `More than one item matches ${c.text} on ${name}. Say which one.` };
      const word = c.text.replace(/^./, ch => ch.toLowerCase());
      if (!hit) return { say: `No, ${word} isn’t on ${name}.`, react: 'look' };
      const shown = hit.text.replace(/^./, ch => ch.toLowerCase());
      return { say: hit.done ? `${shown} is on ${name}, but it’s ticked off.` : `Yes, ${shown} is on ${name}.`, react: 'look', app: 'lists' };
    }
    if (c.op === 'edit') {
      // same rule as remove: one item by its words, never a guess between several; POST /api/lists/edit checks the new text
      const lists = await readLists(READ_TIMEOUT_MS);
      const l = lists.find(x => x.id === c.list);
      if (!l) return { say: `I can’t reach ${name} right now.` };
      const { hit, ambiguous } = pickItem(l.items, c.text, false);
      if (!hit) return { say: ambiguous ? `More than one item matches ${c.text} on ${name}. Say which one.` : `I can’t find ${c.text} on ${name}.` };
      return editSay(l.id, hit.id, hit.text, c.to, name);
    }
    const lists = await readLists(READ_TIMEOUT_MS);
    const l = lists.find(x => x.id === c.list);
    const open =l ? l.items.filter(i => !i.done).map(i => i.text) : [];
    if (!open.length) return { say: `There’s nothing on ${name}.` };
    const shown = open.slice(0, 8);
    const more = open.length - shown.length;
    const words = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
    return { say: `On ${name}: ${words}${more ? `, and ${more} more` : ''}.`, react: 'look', app: 'lists' };
  } catch { return { say: `I can’t reach ${name} right now.` }; }
}

const lower = (s: string): string => s.replace(/^./, ch => ch.toLowerCase());
/** A family list as a reply names it: "the camping list", or "the packing list" for a list already named "Packing list". */
const spokenList = (name: string): string => /list$/i.test(name.trim()) ? `the ${name.trim().toLowerCase()}` : `the ${name.toLowerCase()} list`;
const spokenName = (l: { id: string; name: string }): string =>
  (l.id === 'shopping' ? 'the shopping list' : l.id === 'todo' ? 'the to-do list' : spokenList(l.name));

/** POST /api/lists/edit and the reply to say. */
async function editSay(list: string, id: string, was: string, to: string, name: string): Promise<CommandResult> {
  let r: ListsResult;
  try { r = await writeList('edit', { list, id, text: to }); }
  catch (e) { return queuedReply(e, `Changed ${lower(was)} to ${lower(to)} on ${name}.`); }
  if (!r?.ok) return { say: r?.error ?? `I couldn’t change that on ${name}.` };
  return { say: `Changed ${lower(was)} to ${lower(r.item?.text ?? to)} on ${name}.`, react: 'hop' };
}

/** "change milk to oat milk" with no list said: the one item with exactly those words on any list.
 *  null when there is none (or the PC can't be reached), so the phrase is left to the other commands and Claude. */
async function editAnywhere(text: string, to: string): Promise<CommandResult | null> {
  const lists = await readLists(READ_TIMEOUT_MS).catch(() => null);
  if (!lists) return null;
  const hits = findExact(lists, text);
  if (!hits.length) return null;
  if (hits.length > 1) return { say: `${text} is on more than one list. Say which list.` };
  const { list, item } = hits[0];
  const name = spokenName(list);
  try { return await editSay(list.id, item.id, item.text, to, name); } catch { return { say: `I can’t reach ${name} right now.` }; }
}

// ---------- Home Assistant: "turn off the kitchen light", "lights on" ----------
/** Only devices on the Home dashboard; no match (or no dashboard) means null, and Claude gets it as before. */
async function homeOnOff(raw: string): Promise<CommandResult | null> {
  if (!parseOnOff(raw)) return null;   // not an on/off phrase: don't ask the PC at all
  let dash: HaDashboard;
  try { dash = await getJson<HaDashboard>('/api/home-assistant/layout', READ_TIMEOUT_MS); } catch { return null; }
  if (!dash?.layout || !Array.isArray(dash.entities)) return null;
  const list: VoiceDevice[] = dash.entities.filter(e => !e.missing && !e.readonly)
    .map(e => ({ entity_id: e.entity_id, domain: e.domain, name: dash.layout.names?.[e.entity_id] || e.name }));
  const m = matchHome(raw, list);
  if (!m) return null;
  // null: the PC could not be reached for that device (kept apart from the PC's own { ok: false, error })
  const results = await Promise.all(m.targets.map(d =>
    postJson<HaResult>('/api/home-assistant/toggle', { entity_id: d.entity_id, on: m.on, voice: true }, READ_TIMEOUT_MS).catch(() => null)));
  return onOffReply(m, results);
}
