// Voice for the calendar on a named weekday: "what's on Saturday", "do I have anything on Friday". Pure (no DOM, no fetch).
// voice-commands.ts reads the events (GET /api/calendar/local) for that day and passes them to calendarDaySay.
import { DAY_WORDS } from './voice-parse.ts';

/** The day a calendar question asks about: days ahead of today, and the words to say it with. */
export interface CalDay { ahead: number; name: string }

/** The day a calendar question asks about, or null when the phrase is not one. A weekday means its next day, today included. */
export function calendarDay(t: string, today = new Date().getDay()): CalDay | null {
  const w = /^(?:what(?:'s| is) on|what do i have on|do i have anything on|have i got (?:anything )?on|what have i got on)(?: the calendar| my calendar)? (?:on )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(t);
  if (!w) return null;
  return { ahead: (DAY_WORDS[w[1]] - today + 7) % 7, name: `on ${w[1].replace(/^./, c => c.toUpperCase())}` };
}

/** "What's next on my calendar": the next event today, read by calendarCommand('today'). */
export function nextEventWord(t: string): boolean {
  return /^(?:what(?:'s|s| is) next(?: on my calendar| on the calendar| today)?|when(?:'s|s| is) my next (?:appointment|event|meeting)|what(?:'s|s| is) my next (?:appointment|event|meeting)|what have i got next)$/.test(t);
}

// Words that begin a "when is ..." question answered elsewhere (or not about the calendar): not searched.
const NOT_AN_EVENT = /^(?:it|that|this|they|he|she|sun|sunset|sunrise|christmas|tomorrow|today|next|weather|alarm|timer|bins?)\b/;

/** "When is the dentist", "when's swimming": the words to find in an event's title, or null when the phrase is not about an event. */
export function eventWhenWord(t: string): string | null {
  const m = /^when(?:'s|s| is) (?:the |my |our )?(.+)$/.exec(t);
  if (!m) return null;
  const want = m[1].trim();
  if (!want || NOT_AN_EVENT.test(want)) return null;
  return want;
}

/** The next event (not yet over) whose title holds these words, the earliest first. Null when none does. */
export function findEventWhen<E extends { title: string; start: number; end: number }>(events: E[], want: string, nowMs: number): E | null {
  const w = want.toLowerCase();
  const hits = events.filter(e => e.end > nowMs && e.title.toLowerCase().includes(w));
  return hits.sort((a, b) => a.start - b.start)[0] ?? null;
}

/** The events that overlap the day [startMs, endMs): a multi-day event or one that began the day before is still on that day. */
export function overlapsDay<E extends { start: number; end: number }>(events: E[], startMs: number, endMs: number): E[] {
  return events.filter(e => e.start < endMs && e.end > startMs);
}

/** What the voice says: the events for that day (already worded, "Dentist at 9:00 AM"), up to three, or that nothing is on. */
export function calendarDaySay(items: string[], name: string): string {
  if (!items.length) return `Nothing on your calendar ${name}.`;
  const shown = items.slice(0, 3);
  const more = items.length - shown.length;
  const words = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join('; ')}; and ${shown[shown.length - 1]}`;
  return `${name.replace(/^./, c => c.toUpperCase())}: ${words}${more > 0 ? `, and ${more} more` : ''}.`;
}
