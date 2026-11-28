// Temperature questions by voice: "how cold is it", "do I need a jacket", "is it hot outside". Pure, so Node tests load it.
import type { CommandResult } from './voice-commands.ts';

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
export function rainingNow(t: string): 'raining' | 'snowing' | null {
  if (/^is it raining(?: outside| right now| now)?$/.test(t)) return 'raining';
  if (/^is it snowing(?: outside| right now| now)?$/.test(t)) return 'snowing';
  return null;
}

/** The yes or no for what is falling now, from the forecast's current weather code (WMO: 51-67 and 80-82 rain, 95-99 storms, 71-77 and 85-86 snow). */
export function nowSay(code: number, asked: 'raining' | 'snowing'): string {
  if (asked === 'snowing') {
    return (code >= 71 && code <= 77) || (code >= 85 && code <= 86) ? 'Yes, it’s snowing.' : 'No, it’s not snowing right now.';
  }
  const wet = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99);
  return wet ? 'Yes, it’s raining.' : 'No, it’s not raining right now.';
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
