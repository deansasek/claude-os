// Temperature questions by voice: "how cold is it", "do I need a jacket", "is it hot outside". Pure, so Node tests load it.
import type { CommandResult } from './voice-commands.ts';

// Returns the day they are about (0 today, 1 tomorrow), or null when the phrase is not a temperature question.

export function temperatureDay(t: string): 0 | 1 | null {
  if (/^(?:what(?:'s| is) the temperature tomorrow|how (?:cold|hot|warm) (?:is it|will it be|is it going to be) tomorrow|is it going to be (?:hot|cold|warm|chilly) tomorrow|do i need a (?:jacket|coat|sweater|hoodie) tomorrow)$/.test(t)) return 1;
  if (/^(?:what(?:'s| is) the temperature(?: today| now| right now| outside)?|how (?:cold|hot|warm) is it(?: today| now| right now| outside)?|is it (?:hot|cold|warm|chilly)(?: outside| today| right now)?|how warm is it|do i need a (?:jacket|coat|sweater|hoodie)(?: today| now| outside)?)$/.test(t)) return 0;
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
