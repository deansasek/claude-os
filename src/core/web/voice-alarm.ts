// Voice words for the Clock's alarms: "stop" and "snooze" act on the ring that is sounding. Only "turn off all my
// alarms" switches every alarm off. Pure text matching, so Node tests can load it (core/web/voice-commands.ts uses it).
import { parseDuration, sayDuration } from './voice-parse.ts';

export type AlarmWord = 'stop-ring' | 'snooze' | 'all-off' | 'one-alarm' | null;

/** t: the lower-case command text. ringing: true while an alarm or timer is sounding. */
export function alarmWord(t: string, ringing: boolean): AlarmWord {
  if (ringing) {
    if (/^(?:stop|silence|dismiss|turn off|cancel)(?: it| that| the alarm| the timer| my alarm| my timer)?$/.test(t)) return 'stop-ring';
    if (/^snooze(?: it| that| the alarm)?$/.test(t)) return 'snooze';
  }
  if (/^(?:turn off|cancel|disable|switch off|clear|delete)(?: all)?(?: of)?(?: my| the)? alarms$/.test(t)) return 'all-off';
  if (/^stop all(?: of)?(?: my| the)? alarms$/.test(t)) return 'all-off';
  if (/^(?:stop|turn off|cancel|disable|switch off|delete)(?: the| my)? alarm$/.test(t)) return 'one-alarm';
  return null;
}

/** The time phrase in "turn off my 7 am alarm" ("7 am"), or null when the phrase names no single alarm. */
export function alarmTimePhrase(t: string): string | null {
  const m = t.match(/^(?:turn off|cancel|disable|switch off|delete) (?:my |the )?(.+?) alarm$/);
  return m && /\d/.test(m[1]) ? m[1] : null;   // a time has a digit: "my" or "all" is not a time
}

/** The time phrase in "turn on my 7 am alarm" or "switch my 6:30 alarm back on" ("7 am"), or null when no time is named. */
export function alarmOnTimePhrase(t: string): string | null {
  const m = t.match(/^(?:turn on|switch on|enable) (?:my |the )?(.+?) alarm$/) ?? t.match(/^(?:turn|switch) (?:my |the )?(.+?) alarm (?:back )?on$/);
  return m && /\d/.test(m[1]) ? m[1] : null;
}

export type TimerWord ={ op: 'pause' } | { op: 'resume' } | { op: 'nudge'; minutes: number } | { op: 'cancel-all' } | { op: 'cancel-named'; label: string };
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };

/** "What time will the timer go off", "when does the timer finish": the clock time the timer ends, asked for. */
export function timerEndWord(t: string): boolean {
  return /^(?:what time (?:will|does) the timer (?:go off|finish|end|ring)|when (?:will|does) the timer (?:go off|finish|end|ring|be done)|when is the timer up)$/.test(t);
}

/** "wake me up in 30 minutes", "set an alarm in an hour": the time from now in ms, or null. Needs a unit (minutes, hours),
 *  so "set an alarm for 7" is not this (it is a clock time). */
export function alarmInMs(t: string): number | null {
  const m = /^(?:wake me(?: up)? in|set (?:an |the )?alarm in|set (?:an |the )?alarm for|alarm in) (.+?)(?: from now)?$/.exec(t);
  if (!m || !/\b(?:minutes?|mins?|hours?|hrs?)\b/.test(m[1])) return null;
  return parseDuration(m[1]);
}

/** "How long until my alarm": the time left, in minutes and hours for a ring within a day, and the day for one further off
 *  ("Your next alarm is 7:00 AM next Saturday, in 5 days."). at and now are ms; hm is the clock time; when is the day word. */
export function alarmUntilSay(at: number, now: number, hm: string, when: string): string {
  const mins = Math.round((at - now) / 60000);
  if (mins < 1) return 'Your alarm goes off in under a minute.';
  if (mins >= 24 * 60) {
    const days = Math.floor(mins / (24 * 60));
    return `Your next alarm is ${hm} ${when}, in ${days} day${days === 1 ? '' : 's'}.`;
  }
  return `Your alarm goes off in ${sayDuration(mins * 60000)}.`;
}

/** "How long is left on the pasta timer": the label of one timer, or null. A bare "the timer" or a time is not a label. */
export function namedTimerLeftLabel(t: string): string | null {
  const m = t.match(/^(?:how (?:much time|long)(?:'s| is)? (?:left|remaining|to go)|how much longer(?: is it)?|time left) on (?:the |my )?(.+?) timer$/);
  if (!m || /^(?:the|my|a|an|this|that)$/.test(m[1]) || /\d/.test(m[1])) return null;
  return m[1];
}

/** Timer voice words: "pause the timer", "resume the timer", "add five minutes to the timer", "take 2 minutes off the timer". */
export function timerWord(t: string): TimerWord | null {
  if (/^(?:pause|hold|freeze)(?: the| my)? timer$/.test(t)) return { op: 'pause' };
  if (/^(?:resume|continue|restart|unpause)(?: the| my)? timer$/.test(t)) return { op: 'resume' };
  if (/^(?:cancel|stop|delete|clear|end|kill|turn off)(?: all)?(?: of)? (?:the |my )?timers$/.test(t)) return { op: 'cancel-all' };
  // "cancel the pasta timer": one timer by its label. A bare "the timer" or a time ("10 minute timer") is not a label.
  const named = t.match(/^(?:cancel|stop|delete|clear|end|kill|turn off) (?:the |my )?(.+?) timer$/);
  if (named && !/^(?:the|my|all|a|an|one|this|that)$/.test(named[1]) && !/\d/.test(named[1])) return { op: 'cancel-named', label: named[1] };
  // "add five more minutes to the timer", "give me two extra minutes on the timer": "more" or "extra" may come after the number
  const add = t.match(/^(?:add|give me) (\w+)(?: more| extra)? (?:minutes?|mins?) (?:to|on) (?:the|my) timer$/);
  const take = t.match(/^(?:take|remove) (\w+)(?: more| extra)? (?:minutes?|mins?) (?:off|from) (?:the|my) timer$/);
  // "add an hour to the timer", "take half an hour off the timer": 60 or 30 minutes
  const span = t.match(/^(add|give me|take|remove) (an hour|one hour|1 hour|half an hour) (?:to|on|off|from) (?:the|my) timer$/);
  if (span) return { op: 'nudge', minutes: (/^(?:add|give me)$/.test(span[1]) ? 1 : -1) * (/half/.test(span[2]) ? 30 : 60) };
  const m = add ?? take;
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? +m[1] : (NUMBER_WORDS[m[1]] ?? 0);
  if (n < 1 || n > 60) return null;
  return { op: 'nudge', minutes: add ? n : -n };
}

/** "what alarms do I have", "which alarms are on", "list my alarms": every alarm that is on, not only the next one. */
/** "is my alarm set for tomorrow", "do I have an alarm tomorrow": a question about tomorrow's alarms. */
/** "How long until my alarm", "how much sleep do I get": the time left until the next alarm rings. */
export function alarmUntilWord(t: string): boolean {
  return /^(?:how long (?:until|till|til) my alarm(?: goes off| rings)?|how much sleep do i get)$/.test(t);
}

export function alarmTomorrowWord(t: string): boolean {
  return /^(?:is my alarm (?:set )?(?:for )?tomorrow|do i have an alarm (?:set )?(?:for )?tomorrow|have i got an alarm (?:set )?(?:for )?tomorrow|what time(?:'s| is) my alarm tomorrow|(?:when|when's|when is) my alarm tomorrow|is there an alarm (?:set )?(?:for )?tomorrow)$/.test(t);
}

/** "what alarms do I have", "which alarms are on", "list my alarms": every alarm that is on, not only the next one. */
export function alarmsListWord(t: string): boolean {
  return /^(?:what alarms (?:do i have|are on|are set)(?: set| on)?|which alarms are on|list my alarms|what are my alarms)$/.test(t);
}
