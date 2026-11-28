// Voice words for the Clock's alarms: "stop" and "snooze" act on the ring that is sounding. Only "turn off all my
// alarms" switches every alarm off. Pure text matching, so Node tests can load it (core/web/voice-commands.ts uses it).

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

export type TimerWord = { op: 'pause' } | { op: 'resume' } | { op: 'nudge'; minutes: number } | { op: 'cancel-all' };
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };

/** Timer voice words: "pause the timer", "resume the timer", "add five minutes to the timer", "take 2 minutes off the timer". */
export function timerWord(t: string): TimerWord | null {
  if (/^(?:pause|hold|freeze)(?: the| my)? timer$/.test(t)) return { op: 'pause' };
  if (/^(?:resume|continue|restart|unpause)(?: the| my)? timer$/.test(t)) return { op: 'resume' };
  if (/^(?:cancel|stop|delete|clear|end|kill|turn off)(?: all)?(?: of)? (?:the |my )?timers$/.test(t)) return { op: 'cancel-all' };
  const add = t.match(/^(?:add|give me) (\w+) (?:minutes?|mins?) (?:to|on) (?:the|my) timer$/);
  const take = t.match(/^(?:take|remove) (\w+) (?:minutes?|mins?) (?:off|from) (?:the|my) timer$/);
  const m = add ?? take;
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? +m[1] : (NUMBER_WORDS[m[1]] ?? 0);
  if (n < 1 || n > 60) return null;
  return { op: 'nudge', minutes: add ? n : -n };
}
