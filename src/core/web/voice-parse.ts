// Pure voice parsing for the Clock, Routines and calendar phrases: durations, times of day and day lists.
// No browser imports, so Node tests load it (test/voice-parse.test.ts). core/web/voice-commands.ts imports it.

/** "a" or "an" before a spoken word or number: "an egg timer", "an 80 percent chance", "a 30 percent chance".
 *  A number takes "an" when it is said with a vowel sound: 8, 11, 18 and 80 to 89. */
export function articleFor(word: string | number): 'a' | 'an' {
  const s = String(word).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89) ? 'an' : 'a';
  }
  return /^[aeiou]/i.test(s) ? 'an' : 'a';
}

export function parseDuration(phrase: string): number | null {
  let s = ` ${phrase} `
    // "a couple of minutes" is 2 minutes; only before a time unit
    .replace(/ (a )?couple (of )?(?=(hour|minute|second)s? )/g, ' 2 ')
    .replace(/ (a|an|1) (hour|minute|second)s? and a half /g, ' 1.5 $2s ')
    .replace(/ (\d+) and a half (hour|minute|second)s? /g, ' $1.5 $2s ')
    .replace(/ (\d+) (hour|minute|second)s? and a half /g, ' $1.5 $2s ')
    // "an hour and a quarter" is 75 minutes: the hours, then 15 minutes; "a minute and a quarter" is 75 seconds;
    // "2 and a quarter hours" is the number first
    .replace(/ (\d+) and a quarter hours? /g, ' $1 hours 15 minutes ')
    .replace(/ (\d+) and a quarter minutes? /g, ' $1 minutes 15 seconds ')
    .replace(/ (a|an|\d+) hours? and a quarter /g, ' $1 hours 15 minutes ')
    .replace(/ (a|an|\d+) minutes? and a quarter /g, ' $1 minutes 15 seconds ')
    .replace(/ (a )?half (an |a )?hour /g, ' 30 minutes ')
    .replace(/ (a )?half (a )?minute /g, ' 30 seconds ')
    // "three quarters of an hour" is 45 minutes; "3" is the form after normalise
    .replace(/ (3|three) quarters (of )?(an |a )?hour /g, ' 45 minutes ')
    .replace(/ (a )?quarter (of )?(an |a )?hour /g, ' 15 minutes ')
    .replace(/ (a|an) (hour|minute|second)/g, ' 1 $2')
    .replace(/ and /g, ' ').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(?:(\d+(?:\.\d+)?) ?(?:hours?|hrs?)\s*)?(?:(\d+(?:\.\d+)?) ?(?:minutes?|mins?)\s*)?(?:(\d+(?:\.\d+)?) ?(?:seconds?|secs?)\s*)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const ms = (+(m[1] || 0) * 3600 + +(m[2] || 0) * 60 + +(m[3] || 0)) * 1000;
  return ms >= 1000 && ms <= 24 * 3600e3 ? ms : null;
}


export interface TimeOfDay { h: number; m: number; meridiem: 'am' | 'pm' | null }
/** "7", "7 30", "6 30 am", "7 o'clock", "half past 6", "quarter to 7", "6 oh 5", "noon", "midnight". */
export function parseTime(phrase: string): TimeOfDay | null {
  let s = ` ${phrase} `.replace(/ o'?clock /g, ' ').replace(/ (a\.? ?m\.?|in the morning|this morning)(?= )/g, ' am ')
    .replace(/ (p\.? ?m\.?|in the (afternoon|evening)|tonight|this (afternoon|evening)|at night)(?= )/g, ' pm ').replace(/\s+/g, ' ').trim()
    .replace(/\b(am|pm) \1\b/g, '$1');   // "7 pm tonight" is "7 pm pm" before this: one meridiem
  // "12 noon" and "12 midnight" are said too
  if (/^(12 )?(noon|midday)$/.test(s)) return { h: 12, m: 0, meridiem: 'pm' };
  if (/^(12 )?midnight$/.test(s)) return { h: 0, m: 0, meridiem: 'am' };
  // "quarter past midnight" is "quarter past 12 am"; "quarter to noon" is "quarter to 12 am" (11:45)
  s = s.replace(/^((?:a )?(?:half|quarter|\d+)(?: minutes?)? )(past|after) midnight$/, '$1$2 12 am')
    .replace(/^((?:a )?(?:half|quarter|\d+)(?: minutes?)? )(to|before) midnight$/, '$1$2 12 pm')
    .replace(/^((?:a )?(?:half|quarter|\d+)(?: minutes?)? )(past|after) (noon|midday)$/, '$1$2 12 pm')
    .replace(/^((?:a )?(?:half|quarter|\d+)(?: minutes?)? )(to|before) (noon|midday)$/, '$1$2 12 am');
  let mer: 'am' | 'pm' | null = null;
  const mm = s.match(/^(.*) (am|pm)$/);
  if (mm) { s = mm[1]; mer = mm[2] as 'am' | 'pm'; }
  let h: number, m: number, r: RegExpMatchArray | null;
  // "a quarter to 7" and "a half past 6" are said with an "a" in front too
  if ((r = s.match(/^(?:a )?(half|quarter|\d+)(?: minutes?)? (past|after|to|before) (\d+)$/))) {
    const by = r[1] === 'half' ? 30 : r[1] === 'quarter' ? 15 : +r[1];
    h = +r[3]; m = r[2] === 'to' || r[2] === 'before' ? 60 - by : by;
    if (r[2] === 'to' || r[2] === 'before') { h -= 1; if (h === 0) h = 12; }   // "quarter to 1" is 12:45, not midnight
    if (by >= 60 || h < 0) return null;
  } else if ((r = s.match(/^(\d{1,2})(?: (?:oh )?(\d{1,2}))?$/))) {
    h = +r[1]; m = r[2] ? +r[2] : 0;
    if (/ oh /.test(` ${s} `) && m > 9) return null;
  } else if ((r = s.match(/^(\d{3,4})$/))) {   // "730" from some recognisers
    h = Math.floor(+r[1] / 100); m = +r[1] % 100;
  } else return null;
  if (m > 59 || h > 23) return null;
  if (mer && h > 12) return null;
  // "12 tonight" and "12 at night" are midnight, not noon: the night words make 12 the small hour
  if (mer === 'pm' && h === 12 && /(^| )(tonight|at night)( |$)/.test(phrase.toLowerCase())) return { h, m, meridiem: 'am' };
  return { h, m, meridiem: mer };
}

export const DAY_WORDS: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
/** "", "tomorrow", "on weekdays", "every day", "on mondays", "every monday and friday" → days ([] = once); null if not understood. */
export function parseDays(phrase: string): number[] | null {
  const s0 = phrase.trim();
  if (!s0 || /^(for )?(tomorrow|today|tonight)( morning)?$/.test(s0)) return [];
  // "on weekday mornings", "on monday mornings": the time of day is not a day, so it is dropped first.
  // "every morning" and "each night" stay as they are: there the word is the repeat.
  const bare = s0.replace(/ (?:mornings?|nights?|evenings?)$/, '');
  const s = bare !== s0 && !/^(?:every|each|on|for)?$/.test(bare) ? bare : s0;
  if (/^(every|each) (day|morning|night)$|^daily$/.test(s)) return [0, 1, 2, 3, 4, 5, 6];
  if (/^(on |every )?(weekdays|weekday|work ?days)$/.test(s)) return [1, 2, 3, 4, 5];
  if (/^(?:(?:on|every|at|on the|at the) )?(?:weekends?|the weekend)$/.test(s)) return [0, 6];
  const r = s.match(/^(?:on |every )((?:[a-z]+days?(?:,? (?:and )?)?)+)$/);
  if (r) {
    const days = r[1].split(/,? (?:and )?|,/).map(w => w.replace(/s$/, '')).filter(Boolean);
    // a day named twice is saved once, in the order heard ("monday and monday" is [1])
    if (days.every(d => d in DAY_WORDS)) return [...new Set(days.map(d => DAY_WORDS[d]))];
  }
  return null;
}

/** True when the day phrase names tomorrow, so "7 tomorrow morning" is 7 am: "tomorrow", "tomorrow morning", "for tomorrow". */
export function morningDays(daysPhrase: string): boolean {
  return /^(for )?tomorrow/.test(daysPhrase.trim().toLowerCase());
}

/** A duration with a name after it: "10 minute pasta" is 10 minutes, named pasta. The longest duration at the front wins. */
export function durationAndLabel(phrase: string): { ms: number; label: string } | null {
  const words = phrase.trim().split(/\s+/);
  for (let i = words.length - 1; i >= 1; i--) {
    const ms = parseDuration(words.slice(0, i).join(' '));
    if (ms != null) return { ms, label: words.slice(i).join(' ') };
  }
  return null;
}

export function sayDuration(ms: number): string {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  const part = (n: number, w: string) => (n ? `${n} ${w}${n === 1 ? '' : 's'}` : '');
  if (!h && m === 1 && sec === 30) return 'a minute and a half';
  return [part(h, 'hour'), part(m, 'minute'), part(sec, 'second')].filter(Boolean).join(' and ') || 'no time';
}

/** A named timer said with the label first ("set a pasta timer for 10 minutes") or the duration first ("set a 10 minute timer for the pasta"). */
export function labelledTimer(t: string): { ms: number; label: string } | null {
  const labelFirst = /^(?:set|start)(?: me)?(?: a| an| the)? (.+?) timer (?:for|of) (.+)$/.exec(t);
  // a plain "set a timer for 10 minutes" has no label: the "a" is not one
  if (labelFirst && !/^(?:a|an|the)$/.test(labelFirst[1])) {
    const ms = parseDuration(labelFirst[2].replace(/^(a|an) (?=\d)/, ''));
    if (ms != null) return { ms, label: labelFirst[1] };
  }
  const durationFirst = /^(?:set|start)(?: a| an)? (.+?) timer for (?:the )?(.+)$/.exec(t);
  if (durationFirst) {
    const ms = parseDuration(durationFirst[1].replace(/^(a|an) (?=\d)/, ''));
    if (ms != null) return { ms, label: durationFirst[2] };
  }
  return null;
}

/** The reply for a named timer: the label with a capital first letter, then the duration. The stored label keeps the case heard. */
export function namedTimerReply(label: string, ms: number): string {
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} timer set for ${sayDuration(ms)}.`;
}

/** Turn a spoken time into 24-hour h:m: with no am/pm, a wake-up or a repeating alarm is in the morning,
 *  otherwise it's the next time that comes round. The answer always says which ("6:30 AM"). */
export function resolveHour(t: TimeOfDay, wakeUp: boolean): { h: number; m: number } {
  if (t.meridiem === 'am') return { h: t.h % 12, m: t.m };
  if (t.meridiem === 'pm') return { h: (t.h % 12) + 12, m: t.m };
  if (t.h > 12 || t.h === 0) return { h: t.h, m: t.m };
  if (wakeUp) return { h: t.h % 12, m: t.m };
  const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
  const am = (t.h % 12) * 60 + t.m, pm = am + 720;
  const next = [am, pm].map(x => (x - mins + 1440) % 1440 || 1440);
  return next[0] <= next[1] ? { h: t.h % 12, m: t.m } : { h: (t.h % 12) + 12, m: t.m };
}

export const daysText = (d: number[]) => {
  const uniq = [...new Set(d)], key = uniq.slice().sort((a, b) => a - b).join();
  // Monday first: Sunday (0) comes last, so the sort key shifts 0 to 6
  const names = uniq.slice().sort((a, b) => (a + 6) % 7 - (b + 6) % 7)
    .map(x => Object.keys(DAY_WORDS)[x].replace(/^./, c => c.toUpperCase()) + 's');
  const list = names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return uniq.length === 7 ? ' every day' : key === '1,2,3,4,5' ? ' on weekdays' : key === '0,6' ? ' at weekends'
    : uniq.length ? ` on ${list}` : '';
};

/** A family member backing out of Claude: "stop", "never mind then", "oh never mind", "no thank you", "forget it then".
 *  The text is already lower case. Whole phrases only; "cancel that" is left out (it could mean the timer just set). */
export function isDismiss(t: string): boolean {
  return /^(?:(?:oh|ok|okay|well|hmm|right) )?(?:stop(?: listening)?|cancel|never ?mind(?: then| please| now)?|nothing|forget it(?: then| please)?|that's all|thats all|no that's all|no thats all|no thanks|no thank you|thank you|thanks)$/.test(t.trim());
}
