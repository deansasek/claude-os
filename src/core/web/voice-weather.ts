// Temperature questions by voice: "how cold is it", "do I need a jacket", "is it hot outside". Pure, so Node tests load it.
import type { CommandResult } from './voice-commands.ts';
import { aqiLabel } from '../../apps/weather/web/air.ts';
import { DAY_WORDS } from './voice-parse.ts';

// The forecast's local time ("2026-11-27T16:21") said as the Weather app says it: "4:21 PM". Same output as format.ts localHour.
const clock12 = (iso: string): string => {
  const h = +iso.slice(11, 13), m = iso.slice(14, 16);
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
};

// Returns the day they are about (0 today, 1 tomorrow), or null when the phrase is not a temperature question.

export function temperatureDay(t: string): 0 | 1 | null {
  if (/^(?:what(?:'s| is) the temperature tomorrow|how (?:cold|hot|warm) (?:is it|will it be|is it going to be) tomorrow|is it going to be (?:hot|cold|warm|chilly) tomorrow|do i need a (?:jacket|coat|sweater|hoodie) tomorrow)$/.test(t)) return 1;
  if (/^(?:what(?:'s| is) the temperature(?: today| now| right now| outside)?|how (?:cold|hot|warm) is it(?: today| now| right now| outside)?|is it (?:hot|cold|warm|chilly)(?: outside| today| right now)?|how (?:cold|hot|warm) (?:will it be|is it going to be)(?: today)?|is it going to be (?:hot|cold|warm|chilly)(?: today)?|how warm is it|do i need a (?:jacket|coat|sweater|hoodie)(?: today| now| outside)?)$/.test(t)) return 0;
  return null;
}

/** Today's sunrise or sunset: "is at ... today" while it is still to come, else "was at ... today" and tomorrow's time.
 *  todayIso and tomorrowIso are the forecast's local times ("2026-11-27T16:21"); now is the tablet's clock (same place). */
export function sunSay(which: 'sunrise' | 'sunset', todayIso: string, tomorrowIso: string | undefined, now: Date): string {
  const label = which === 'sunset' ? 'Sunset' : 'Sunrise';
  const pad = (n: number) => String(n).padStart(2, '0');
  const nowHm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const todayHm = todayIso.slice(11, 16);
  if (todayHm > nowHm) return `${label} is at ${clock12(todayIso)} today.`;
  if (!tomorrowIso) return `${label} was at ${clock12(todayIso)} today.`;
  return `${label} was at ${clock12(todayIso)} today. Tomorrow it’s at ${clock12(tomorrowIso)}.`;
}

// Sun questions by voice: "what time is sunset", "when does it get dark tomorrow". Returns the time asked about and the day.
export function sunDay(t: string): { which: 'sunrise' | 'sunset'; day: 0 | 1 } | null {
  const day: 0 | 1 = / tomorrow$/.test(t) ? 1 : 0;
  // "today" and "tomorrow" both come off the end; only "tomorrow" moves the answer to the next day
  const base = t.replace(/ (?:tomorrow|today)$/, '');
  if (/^(?:what time is (?:the )?sunset|what time does the sun set|when (?:is|does) (?:the )?sunset|when does the sun set|when does it get dark|what time does it get dark)$/.test(base)) return { which: 'sunset', day };
  if (/^(?:what time is (?:the )?sunrise|what time does the sun rise|when (?:is|does) (?:the )?sunrise|when does the sun rise|when does it get light|what time does it get light)$/.test(base)) return { which: 'sunrise', day };
  return null;
}

// "Is it raining" or "is it snowing" right now (not the chance later on). Returns what is asked about, or null.
export function rainingNow(t: string): 'raining' | 'snowing' | 'foggy' | null {
  if (/^is it raining(?: outside| right now| now)?$/.test(t)) return 'raining';
  if (/^is it snowing(?: outside| right now| now)?$/.test(t)) return 'snowing';
  if (/^is it foggy(?: outside| right now| now)?$/.test(t)) return 'foggy';
  return null;
}

/** The yes or no for what is falling now, from the forecast's current weather code (WMO: 51-67 and 80-82 rain, 95-99 storms, 71-77 and 85-86 snow). */
export function nowSay(code: number, asked: 'raining' | 'snowing' | 'foggy'): string {
  if (asked === 'foggy') return code === 45 || code === 48 ? 'Yes, it’s foggy.' : 'No, it’s not foggy right now.';
  if (asked === 'snowing') {
    return (code >= 71 && code <= 77) || (code >= 85 && code <= 86) ? 'Yes, it’s snowing.' : 'No, it’s not snowing right now.';
  }
  const wet = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99);
  return wet ? 'Yes, it’s raining.' : 'No, it’s not raining right now.';
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** The weekday name for a getDay() number (0 Sunday to 6 Saturday). */
export const weekdayName = (dow: number): string => DAY_NAMES[((dow % 7) + 7) % 7];

/** A weather question about a named weekday: "what's the weather on Saturday", "will it rain on Friday".
 *  todayDow is today's getDay() number. Returns how many days ahead (0 is today) and the rain or snow asked about, or null. */
export function forecastDay(t: string, todayDow: number): { day: number; rainOnly: 'rain' | 'snow' | null } | null {
  const m = t.match(/^(.+) on ([a-z]+)$/);
  if (!m) return null;
  const target = DAY_WORDS[m[2]];
  if (target === undefined) return null;
  const prefix = m[1];
  if (!/^(?:what(?:'s| is) the weather(?: like)?|how(?:'s| is) the weather|weather|will it (?:rain|snow|be (?:sunny|cold|hot|windy|wet))|is it going to (?:rain|snow|be (?:sunny|cold|hot|windy|wet))|is it (?:sunny|cold|hot|windy|wet)|do i need an umbrella|do i need a (?:jacket|coat))$/.test(prefix)) return null;
  const rainOnly = /\brain\b|umbrella/.test(prefix) ? 'rain' : /\bsnow\b/.test(prefix) ? 'snow' : null;
  return { day: (target - todayDow + 7) % 7, rainOnly };
}

// Air quality questions by voice: "what's the air quality", "how's the air today", "is the air good".
export function airWord(t: string): boolean {
  return /^(?:what(?:'s| is) the air quality(?: today| outside| like| right now| now)?|how(?:'s| is) the air(?: quality)?(?: today| outside| right now)?|is the air (?:good|bad|clean|ok)(?: today| outside)?)$/.test(t);
}

/** The air quality from the Weather screen's US AQI, with the same band words as its air line. */
export function airSay(aqi: number | null): string {
  if (aqi == null || !Number.isFinite(aqi)) return 'I can’t get the air quality right now.';
  return `Air quality is ${Math.round(aqi)}: ${aqiLabel(aqi)}.`;
}

// Humidity questions by voice: "how humid is it", "what's the humidity outside", "is it humid".
export function humidWord(t: string): boolean {
  return /^(?:how humid is it(?: today| outside| right now)?|what(?:'s| is) the humidity(?: today| outside| right now| now)?|is it humid(?: today| outside| right now)?)$/.test(t);
}

/** The relative humidity now, from the forecast's current block. */
export function humidSay(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return 'I can’t get the humidity right now.';
  return `Humidity is ${Math.round(pct)} percent.`;
}

// Frost and freezing questions for tonight: "will it freeze tonight", "will there be a frost". "Is it freezing" is left out: in speech it means "very cold".
export function frostTonight(t: string): boolean {
  return /^(?:will it freeze(?: tonight)?|is it going to freeze(?: tonight)?|will there be (?:a )?frost(?: tonight)?|is there going to be (?:a )?frost(?: tonight)?|is it going to be below freezing(?: tonight)?|will it be below freezing(?: tonight)?|will it get below freezing(?: tonight)?)$/.test(t);
}

/** The lowest hourly temperature from now until 08:00 tomorrow. Times are location-local ("2026-11-27T15:00").
 *  Returns null when no hour falls in that window. */
export function overnightLow(times: string[], temps: number[], nowIso: string): number | null {
  const today = nowIso.slice(0, 10);
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const start = `${nowIso.slice(0, 13)}:00`, end = `${tomorrow}T08:00`;
  let low: number | null = null;
  times.forEach((iso, i) => {
    const v = temps[i];
    if (iso < start || iso >= end || v == null) return;
    if (low === null || v < low) low = v;
  });
  return low;
}

/** A temperature in degrees, singular for one: "1 degree", "-1 degree", "0 degrees", "2 degrees". */
export function degSay(n: number): string {
  const v = Math.round(n);
  return `${v} ${Math.abs(v) === 1 ? 'degree' : 'degrees'}`;
}

/** "What's the low tonight", "how cold will it get tonight": the overnight low as a number. */
export function lowTonightWord(t: string): boolean {
  return /^(?:how cold (?:will it get|is it going to get|will it be|is it going to be|is it|does it get|does it go) tonight|is it (?:going to be )?cold tonight|what(?:'s| is) the (?:temperature|low)(?: temperature)? tonight|how low will it go tonight|what will the low be tonight|what(?:'s| is) the overnight low)$/.test(t);
}

export function lowTonightSay(low: number): string {
  return `Down to ${degSay(low)} tonight.`;
}

/** The answer for a frost question. The freezing point is 0 degrees Celsius or 32 Fahrenheit, by the user's units. */
export function frostSay(low: number, units: 'celsius' | 'fahrenheit'): string {
  const freezing = units === 'celsius' ? 0 : 32;
  const v = Math.round(low);
  if (low <= freezing) return `Yes, down to ${degSay(v)} tonight: below freezing.`;
  return `No, the low tonight is ${degSay(v)}.`;
}

// Wind questions by voice: "is it windy", "is it going to be windy tomorrow". Returns the day (0 today, 1 tomorrow), or null.
export function windDay(t: string): 0 | 1 | null {
  if (/^(?:is it|will it be|is it going to be) windy tomorrow$|^how windy (?:is it|will it be|is it going to be) tomorrow$/.test(t)) return 1;
  if (/^(?:is it windy|how windy is it|is it windy outside|is it windy today|how windy is it outside|is it going to be windy today)$/.test(t)) return 0;
  return null;
}

// What to say when the forecast did not come back. null (the PC cannot be reached) and the two failed
// statuses get their own words; every other answer returns null and the caller keeps its own reply.
export function weatherTrouble(w: { status: string; city?: string } | null): CommandResult | null {
  if (w === null) return { say: 'The PC isn’t answering, so I can’t get the weather.' };
  if (w.status === 'not_found') {
    return w.city
      ? { say: `Weather can’t find ${w.city}. Pick your city again in the Weather app.`, app: 'weather' }
      : { say: 'Weather can’t find that city.', app: 'weather' };
  }
  if (w.status === 'error') return { say: 'The forecast service isn’t answering right now.' };
  return null;
}
