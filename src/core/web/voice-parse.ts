// Pure voice parsing for the Clock, Routines and calendar phrases: durations, times of day and day lists.
// No browser imports, so Node tests load it (test/voice-parse.test.ts). core/web/voice-commands.ts imports it.

export function parseDuration(phrase: string): number | null {
  let s = ` ${phrase} `
    .replace(/ (a|an|1) (hour|minute|second)s? and a half /g, ' 1.5 $2s ')
    .replace(/ (\d+) and a half (hour|minute|second)s? /g, ' $1.5 $2s ')
    .replace(/ (\d+) (hour|minute|second)s? and a half /g, ' $1.5 $2s ')
    .replace(/ (a )?half (an |a )?hour /g, ' 30 minutes ')
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
  let s = ` ${phrase} `.replace(/ o'?clock /g, ' ').replace(/ (a\.? ?m\.?|in the morning|this morning) /g, ' am ')
    .replace(/ (p\.? ?m\.?|in the (afternoon|evening)|tonight|this (afternoon|evening)|at night) /g, ' pm ').replace(/\s+/g, ' ').trim();
  if (s === 'noon' || s === 'midday') return { h: 12, m: 0, meridiem: 'pm' };
  if (s === 'midnight') return { h: 0, m: 0, meridiem: 'am' };
  let mer: 'am' | 'pm' | null = null;
  const mm = s.match(/^(.*) (am|pm)$/);
  if (mm) { s = mm[1]; mer = mm[2] as 'am' | 'pm'; }
  let h: number, m: number, r: RegExpMatchArray | null;
  if ((r = s.match(/^(half|quarter|\d+)(?: minutes?)? (past|after|to|before) (\d+)$/))) {
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
  const s = phrase.trim();
  if (!s || /^(for )?(tomorrow|today|tonight)( morning)?$/.test(s)) return [];
  if (/^(every|each) (day|morning|night)$|^daily$/.test(s)) return [0, 1, 2, 3, 4, 5, 6];
  if (/^(on |every )?(weekdays|weekday|work ?days)$/.test(s)) return [1, 2, 3, 4, 5];
  if (/^(on |every )?(weekends?)$/.test(s)) return [0, 6];
  const r = s.match(/^(?:on |every )((?:[a-z]+days?(?:,? (?:and )?)?)+)$/);
  if (r) {
    const days = r[1].split(/,? (?:and )?|,/).map(w => w.replace(/s$/, '')).filter(Boolean);
    if (days.every(d => d in DAY_WORDS)) return days.map(d => DAY_WORDS[d]);
  }
  return null;
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

export const daysText = (d: number[]) => d.length === 7 ? ' every day' : d.join() === '1,2,3,4,5' ? ' on weekdays' : d.join() === '0,6' ? ' at weekends'
  : d.length ? ` on ${d.map(x => Object.keys(DAY_WORDS)[x].replace(/^./, c => c.toUpperCase()) + 's').join(' and ')}` : '';
