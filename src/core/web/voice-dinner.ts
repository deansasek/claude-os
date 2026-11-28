// Voice for the Meals dinner: "what's for dinner tonight", "what's for dinner tomorrow", "what's for dinner on Friday",
// "what are we having for dinner". Pure (no DOM, no fetch). voice-commands.ts reads the calendar (GET /api/calendar/local)
// and picks the night with dinnersIn.
import { DAY_WORDS } from './voice-parse.ts';

/** The night a dinner question asks about: days ahead of today, and the words to say it with. */
export interface Night { ahead: number; name: string; lead: string }

const cap = (s: string): string => s.replace(/^./, c => c.toUpperCase());

/** The night a dinner question asks about, or null when the phrase is not a dinner question. A weekday means its next
 *  day, today included (the same rule as the calendar). today: the day of the week now (Date.getDay). */
export function dinnerWord(t: string, today = new Date().getDay()): Night | null {
  const m = /^(?:what(?:'s| is) for dinner|what are we having for dinner)(?: (tonight|tomorrow))?$/.exec(t);
  if (m) return m[1] === 'tomorrow' ? { ahead: 1, name: 'tomorrow', lead: 'Tomorrow' } : { ahead: 0, name: 'tonight', lead: 'Tonight' };
  const w = /^(?:what(?:'s| is) for dinner|what are we having for dinner) (?:on )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(t);
  if (!w) return null;
  const ahead = (DAY_WORDS[w[1]] - today + 7) % 7;
  return { ahead, name: `on ${cap(w[1])}`, lead: `On ${cap(w[1])}` };
}

/** "What's for dinner this week": the whole week's plan, read from tonight. */
export function dinnerWeekWord(t: string): boolean {
  return /^(?:what(?:'s| is) for dinner this week|what are we having for dinner this week|what(?:'s| is) on the dinner menu this week)$/.test(t);
}

/** The week's dinners that are planned: each with its night's name ("Tonight", "Tomorrow", "Friday") and its dinner. */
export function dinnerWeekSay(items: { name: string; text: string }[]): string {
  if (!items.length) return 'Nothing is planned for dinner this week.';
  // only "Tonight" and "Tomorrow" start the sentence in lower case; a weekday keeps its capital
  const parts = items.map((i, k) => `${k === 0 && /^(?:Tonight|Tomorrow)$/.test(i.name) ? i.name.toLowerCase() : i.name}: ${i.text}`);
  const words = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join('; ')}; and ${parts[parts.length - 1]}`;
  return `This week, ${words}.`;
}

/** What the voice says: the dinner planned for that night, or that nothing is planned. */
export function dinnerSay(text: string | null, night: Night): string {
  if (!text) return `Nothing planned for dinner ${night.name}.`;
  // the first letter is lower case only when the next letter is: "Tacos" is "tacos", but "BBQ ribs" and "KFC" keep their capitals
  return `${night.lead} it’s ${text.replace(/^([A-Z])(?=[a-z])/, c => c.toLowerCase())}.`;
}
