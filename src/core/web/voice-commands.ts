// Quick voice commands, handled on the spot without starting a Claude session.
//
// After "Hey Claude", the Claude app's voice.ts first offers what you said to `runCommand`. If it is
// clearly one of these, it's done here and answered aloud; anything else (or anything unclear) is
// left alone and goes to Claude as before. Matching is strict on purpose: whole phrases only.
//
//   Timers   "set a timer for 10 minutes", "five minute timer", "a minute and a half timer",
//            "cancel the timer", "how long is left"
//   Alarms   "wake me up at 7", "set an alarm for 6:30 on weekdays", "alarm for half past six",
//            "turn off my alarms", "when is my alarm"
//   Weather  "what's the weather", "what's the weather tomorrow", "will it rain (today/tomorrow)"
//   Time     "what time is it", "what's the date", "what day is it"
//   Screen   "dim the screen", "brighter", "brightness 50 percent", "dark mode", "light mode"
//   Sound    "volume up/down", "louder", "quieter", "mute", "volume 30 percent"
//   Apps     "open weather / clock / settings / sessions / home"
//   Home     "turn off the kitchen light", "lights on", "switch on the fan" (dashboard devices only; see
//            apps/home-assistant/web/voice-match.ts); "set movie night", "activate good morning" (scenes)
//   Lists    "add milk to the shopping list", "put bin day on my to-do list", "what's on the shopping list"
//            (Shopping and To-do only; see apps/lists/web/voice-match.ts)
//   Calendar "what's on today", "what's on my calendar": the next three events today (read-only);
//            "what's on tomorrow": the first three events tomorrow
//   Routines any phrase a routine has ("good morning"), "run the good night routine", "start good morning",
//            "good night routine" (apps/routines: the Routines app speaks each step itself)
//
// The Clock app provides timers and alarms (provideClock), the Routines app its routines (provideRoutines);
// the rest uses core only.
import { getJson, postJson } from './dom.ts';
import type { HaDashboard, HaResult, HaScenes } from '../../apps/home-assistant/api.ts';
import { matchHome, matchScene, parseOnOff, parseScene, sayName, type VoiceDevice } from '../../apps/home-assistant/web/voice-match.ts';
import type { CalEvent, CalEvents } from '../../apps/calendar/api.ts';
import { isBuiltIn, type ListsResult } from '../../apps/lists/api.ts';
import { matchList } from '../../apps/lists/web/voice-match.ts';
import { device, onTablet } from './device.ts';
import { openApp, prefs } from './system.ts';
import { alarmTimePhrase, alarmWord, timerWord } from './voice-alarm.ts';
import { temperatureDay } from './voice-weather.ts';
import { pickItem } from '../../apps/lists/web/voice-match.ts';
import { parseDuration, parseTime, parseDays, DAY_WORDS, daysText, resolveHour, sayDuration, type TimeOfDay } from './voice-parse.ts';
import { setThemeMode } from './theme.ts';

export interface ClockApi {
  /** label: shown when it rings (Claude's set_timer); the Clock's own controls set none. */
  startTimer(ms: number, label?: string): void;
  cancelTimer(): boolean;
  /** Pause a running timer. False when none runs. */
  pauseTimer(): boolean;
  /** Resume a paused timer. False when none is paused. */
  resumeTimer(): boolean;
  /** Add (positive) or take off (negative) whole minutes. False when no timer is set. */
  nudgeTimer(minutes: number): boolean;
  timerLeft(): number | null;
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
  /** Start a routine by id; false if there is no such routine. Returns at once: the steps run on their own. */
  run(id: string): Promise<boolean>;
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
  status: string; units?: string; place?: string | null;
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
  try { w = await getJson<Wx>('/api/weather/forecast'); } catch { return { say: 'I can’t get the weather right now.' }; }
  if (w.status === 'no_location') return { say: 'Weather needs a place first. Set it in the Weather app.', app: 'weather' };
  if (w.status !== 'ok' || !w.daily) return { say: 'I can’t get the weather right now.' };
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

const APPS: Record<string, string> = {
  weather: 'weather', forecast: 'weather', clock: 'clock', timer: 'clock', timers: 'clock', alarm: 'clock', alarms: 'clock', stopwatch: 'clock',
  settings: 'settings', setting: 'settings', sessions: 'claude', session: 'claude', claude: 'claude', usage: 'claude', home: 'home',
  lists: 'lists', list: 'lists', calendar: 'calendar', diary: 'calendar', routines: 'routines', routine: 'routines',
};
function open(word: string): CommandResult | null {
  const id = APPS[word];
  if (!id || !document.querySelector(`.ri[data-app="${id}"]`)) return null;   // e.g. no Home app yet: let Claude have it
  openApp(id);
  return { say: 'Okay.', react: 'hop', app: id };
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

  // lists: "add milk to the shopping list" (the words as said, not normalised: "two" stays "two")
  // the family's own lists are heard by name too; the lists are read only when the words mention a list
  const customs = /\blist\b/.test(t) ? await voiceCustomLists() : [];
  const list = matchList(raw, customs);
  if (list) return listCommand(list, customs.find(c => c.id === list.list)?.name);

  // timers: the first of these shapes whose duration parses wins
  for (const re of [/^(?:set|start|make|put on|give me)(?: me)?(?: a| an| the)? timer (?:for |of )?(.+)$/, /^timer (?:for )?(.+)$/,
    /^(?:set |start )?(?:a |an )?(.+?) timer$/]) {
    const m = t.match(re);
    const ms = m ? parseDuration(m[1].replace(/^(a|an) (?=\d)/, '')) : null;
    if (ms == null) continue;
    if (!clock) return { say: 'The clock isn’t ready yet. Try again in a moment.' };
    clock.startTimer(ms);
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
  // timer: pause, resume, add or take off minutes (core/web/voice-alarm.ts)
  const tw = timerWord(t);
  if (tw && clock) {
    if (tw.op === 'pause') return clock.pauseTimer() ? { say: 'Timer paused.', react: 'look' } : { say: 'There’s no timer running.' };
    if (tw.op === 'resume') return clock.resumeTimer() ? { say: 'Timer resumed.', react: 'hop' } : { say: 'There’s no paused timer.' };
    if (!clock.nudgeTimer(tw.minutes)) return { say: 'There’s no timer running.' };
    const n = Math.abs(tw.minutes);
    return { say: tw.minutes > 0 ? `Added ${n} minute${n === 1 ? '' : 's'}.` : `Took off ${n} minute${n === 1 ? '' : 's'}.`, react: 'hop' };
  }
  if (/^(?:cancel|stop|delete|clear|end|reset|kill|turn off)(?: the| my)? timer$/.test(t)) {
    if (!clock) return null;
    return { say: clock.cancelTimer() ? 'Timer cancelled.' : 'There’s no timer running.', react: 'look' };
  }
  if (/^(?:how (?:much time|long) (?:is |'s )?(?:left|remaining|to go)(?: on (?:the|my) timer)?|(?:how'?s|how is) (?:the|my) timer(?: doing)?|time left(?: on (?:the|my) timer)?)$/.test(t)) {
    if (!clock) return null;
    const left = clock.timerLeft();
    return { say: left == null ? 'There’s no timer running.' : `${sayDuration(Math.ceil(left / 1000) * 1000)} left.`.replace(/^./, c => c.toUpperCase()) };
  }

  if (/^(?:when(?:'s| is) my (?:next )?alarm|what time is my alarm|is my alarm (?:on|set)|do i have an alarm(?: set)?)$/.test(t)) {
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
    const { h, m: mins } = resolveHour(time, wakeUp || days.length > 0);
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

  // screen
  if (/^(?:dim|jim|darken)(?: the)? screen$|^(?:make|turn)(?: the)? (?:screen|it) (?:dimmer|darker|down)$|^(?:turn|bring)(?: the)? brightness down$|^dimmer$|^(?:screen )?darker$|^lower(?: the)? brightness$/.test(t)) return brightness('down');
  if (/^(?:brighten|light up)(?: the)? screen$|^(?:make|turn)(?: the)? (?:screen|it) (?:brighter|up)$|^(?:turn|bring)(?: the)? brightness up$|^(?:screen )?brighter$|^raise(?: the)? brightness$/.test(t)) return brightness('up');
  if (/^(?:full|max|maximum) brightness$/.test(t)) return brightness(1);
  if ((r = t.match(/^(?:set )?(?:the )?brightness (?:to )?(\d{1,3})(?: percent| %)?$/))) return +r[1] <= 100 ? brightness(+r[1] / 100) : null;
  if (/^(?:turn on |switch to |go |use |enable )?(?:the )?(?:dark|night) (?:mode|theme)$|^(?:turn off|disable)(?: the)? light (?:mode|theme)$/.test(t)) { setThemeMode('dark'); return { say: 'Dark mode.', react: 'look' }; }
  if (/^(?:turn on |switch to |go |use |enable )?(?:the )?(?:light|day) (?:mode|theme)$|^(?:turn off|disable)(?: the)? (?:dark|night) (?:mode|theme)$/.test(t)) { setThemeMode('light'); return { say: 'Light mode.', react: 'hop' }; }

  // sound
  if (/^(?:turn |turn it |turn the volume |volume |sound )?up$|^louder$|^(?:turn|make)(?: it| the volume| the sound)? louder$|^(?:raise|increase)(?: the)? volume$/.test(t) && /up|loud|raise|increase/.test(t)) return volume('up');
  if (/^(?:turn |turn it |turn the volume |volume |sound )?down$|^quieter$|^(?:turn|make)(?: it| the volume| the sound)? quieter$|^(?:lower|decrease|reduce)(?: the)? volume$/.test(t) && /down|quiet|lower|decrease|reduce/.test(t)) return volume('down');
  if (/^(?:mute|silence)(?: the)?(?: sound| volume| tablet)?$/.test(t)) return volume('mute');
  if (/^unmute(?: the)?(?: sound| volume| tablet)?$/.test(t)) return volume('unmute');
  if ((r = t.match(/^(?:set )?(?:the )?volume (?:to )?(\d{1,3})(?: percent| %)?$/))) return +r[1] <= 100 ? volume(+r[1] / 100) : null;

  // apps
  if ((r = t.match(/^(?:open|show(?: me)?|go to|switch to|take me to)(?: the| my)? ([a-z]+)(?: app| screen| page)?$/))) return open(r[1]);
  if (t === 'go home' || t === 'home screen') return open('home');

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
  if (!(await routines.run(hit.id))) return null;
  return { say: '', react: 'hop' };   // the routine speaks each step itself
}

// ---------- Home Assistant scenes: "set movie night", "activate good morning" ----------
/** Only scenes on the Home Assistant dashboard or on the Home screen (the PC checks it again); no match means null. */
async function sceneCommand(raw: string): Promise<CommandResult | null> {
  if (!parseScene(raw)) return null;   // not a "set / activate <scene>" phrase: don't ask the PC at all
  let list: HaScenes;
  try { list = await getJson<HaScenes>('/api/home-assistant/scenes'); } catch { return null; }
  if (list?.status !== 'ok' || !Array.isArray(list.scenes)) return null;
  const m = matchScene(raw, list.scenes.filter(s => s.dashboard || s.home));
  if (!m) return null;
  let r: HaResult;
  try { r = await postJson<HaResult>('/api/home-assistant/scene', { entity_id: m.entity_id }); } catch { r = { ok: false }; }
  return r?.ok ? { say: `${m.name} is on.`, react: 'hop' } : { say: `Couldn’t set ${m.name}.` };
}

// ---------- Calendar: "what's on today", "what's on my calendar" ----------
/** The next three events still to come today, read aloud (the Calendar app's own route, GET /api/calendar/events). */
export async function calendarCommand(day: 'today' | 'tomorrow' = 'today', cachedOnly = false): Promise<CommandResult> {
  let r: CalEvents;
  try { r = await getJson<CalEvents>('/api/calendar/events'); } catch { return { say: 'I can’t reach the calendar right now.' }; }
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
/** The same routes as the Lists app's own taps (POST /api/lists/add, GET /api/lists/lists); the PC checks it all. */
/** Today's or tomorrow's events from the claude.ai calendar connector (GET /api/calendar/connector), read aloud. */
async function connectorCommand(day: 'today' | 'tomorrow', cachedOnly = false): Promise<CommandResult> {
  type Ev = { title: string; start: number; end: number; allDay: boolean };
  let r: { status?: string; events?: Ev[] };
  try { r = await getJson<{ status?: string; events?: Ev[] }>(`/api/calendar/connector?day=${day}${cachedOnly ? '&cached=1' : ''}`); } catch { return { say: 'I can’t reach the calendar right now.' }; }
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

/** The family's own tick-off lists (id and name), for voice. Shopping, To-do and Notes are not among them. */
async function voiceCustomLists(): Promise<{ id: string; name: string }[]> {
  try {
    const r = await getJson<ListsResult>('/api/lists/lists');
    return (r?.lists ?? []).filter(l => !isBuiltIn(l.id)).map(l => ({ id: l.id, name: l.name }));
  } catch { return []; }
}

async function listCommand(c: NonNullable<ReturnType<typeof matchList>>, customName?: string): Promise<CommandResult> {
  const name = c.list === 'shopping' ? 'the shopping list' : c.list === 'todo' ? 'the to-do list' : `the ${(customName ?? 'list').toLowerCase()} list`;
  try {
    if (c.op === 'add') {
      const r = await postJson<ListsResult>('/api/lists/add', { list: c.list, text: c.text });
      if (!r?.ok) return { say: r?.error ?? `I couldn’t add that to ${name}.` };
      return { say: `Added ${c.text.replace(/^./, ch => ch.toLowerCase())} to ${name}.`, react: 'hop' };
    }
    if (c.op === 'tick') {
      // find the one unticked item by its words (exact, or the only partial match); never a guess between several
      const lists = await getJson<ListsResult>('/api/lists/lists');
      const l = lists?.lists?.find(x => x.id === c.list);
      if (!l) return { say: `I can’t reach ${name} right now.` };
      const { hit, ambiguous } = pickItem(l.items, c.text, true);
      if (!hit) return { say: ambiguous ? `More than one item matches ${c.text} on ${name}. Say which one.` : `I can’t find ${c.text} on ${name}.` };
      const r = await postJson<ListsResult>('/api/lists/tick', { list: c.list, id: hit.id, done: true });
      if (!r?.ok) return { say: r?.error ?? `I couldn’t tick that off ${name}.` };
      return { say: `Ticked off ${hit.text.replace(/^./, ch => ch.toLowerCase())} on ${name}.`, react: 'hop' };
    }
    if (c.op === 'addMany') {
      // one add per item, the same route the Lists app uses; the reply says what went on
      let ok = 0;
      for (const text of c.texts) {
        const r = await postJson<ListsResult>('/api/lists/add', { list: c.list, text });
        if (r?.ok) ok++;
      }
      if (!ok) return { say: `I couldn’t add those to ${name}.` };
      const words = c.texts.map(t => t.replace(/^./, ch => ch.toLowerCase()));
      const said = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
      return { say: ok === words.length ? `Added ${said} to ${name}.` : `Added ${ok} of ${words.length} to ${name}.`, react: 'hop' };
    }
    if (c.op === 'clear') {
      const r = await postJson<ListsResult>('/api/lists/clear-done', { list: c.list });
      if (!r?.ok) return { say: r?.error ?? `I couldn’t clear ${name}.` };
      return { say: `Cleared the ticked items on ${name}.`, react: 'hop' };
    }
    if (c.op === 'remove') {
      // same rule as tick off: one item by its words, never a guess between several (open or ticked)
      const lists = await getJson<ListsResult>('/api/lists/lists');
      const l = lists?.lists?.find(x => x.id === c.list);
      if (!l) return { say: `I can’t reach ${name} right now.` };
      const { hit, ambiguous } = pickItem(l.items, c.text, false);
      if (!hit) return { say: ambiguous ? `More than one item matches ${c.text} on ${name}. Say which one.` : `I can’t find ${c.text} on ${name}.` };
      const r = await postJson<ListsResult>('/api/lists/remove', { list: c.list, id: hit.id });
      if (!r?.ok) return { say: r?.error ?? `I couldn’t remove that from ${name}.` };
      return { say: `Removed ${hit.text.replace(/^./, ch => ch.toLowerCase())} from ${name}.`, react: 'hop' };
    }
    const r = await getJson<ListsResult>('/api/lists/lists');
    const l = r?.lists?.find(x => x.id === c.list);
    const open = l ? l.items.filter(i => !i.done).map(i => i.text) : [];
    if (!open.length) return { say: `There’s nothing on ${name}.` };
    const shown = open.slice(0, 8);
    const more = open.length - shown.length;
    const words = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
    return { say: `On ${name}: ${words}${more ? `, and ${more} more` : ''}.`, react: 'look', app: 'lists' };
  } catch { return { say: `I can’t reach ${name} right now.` }; }
}

// ---------- Home Assistant: "turn off the kitchen light", "lights on" ----------
/** Only devices on the Home dashboard; no match (or no dashboard) means null, and Claude gets it as before. */
async function homeOnOff(raw: string): Promise<CommandResult | null> {
  if (!parseOnOff(raw)) return null;   // not an on/off phrase: don't ask the PC at all
  let dash: HaDashboard;
  try { dash = await getJson<HaDashboard>('/api/home-assistant/layout'); } catch { return null; }
  if (!dash?.layout || !Array.isArray(dash.entities)) return null;
  const list: VoiceDevice[] = dash.entities.filter(e => !e.missing && !e.readonly)
    .map(e => ({ entity_id: e.entity_id, domain: e.domain, name: dash.layout.names?.[e.entity_id] || e.name }));
  const m = matchHome(raw, list);
  if (!m) return null;
  const results = await Promise.all(m.targets.map(d =>
    postJson<HaResult>('/api/home-assistant/toggle', { entity_id: d.entity_id, on: m.on, voice: true }).catch(() => ({ ok: false } as HaResult))));
  const failed = m.targets.filter((_, i) => !results[i]?.ok);
  if (!failed.length) return { say: `${m.label}.`, react: m.on ? 'hop' : 'look' };
  if (m.all && failed.length < m.targets.length) return { say: `Couldn’t reach ${failed.length} of the lights.` };
  return { say: m.all ? 'Couldn’t reach the lights.' : `Couldn’t reach the ${sayName(m.targets[0]).replace(/^./, c => c.toLowerCase())}.` };
}
