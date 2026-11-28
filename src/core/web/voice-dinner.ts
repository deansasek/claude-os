// Voice for the Meals dinner: "what's for dinner tonight", "what's for dinner tomorrow", "what are we having for dinner".
// Pure (no DOM, no fetch). voice-commands.ts reads the calendar (GET /api/calendar/local) and picks the night with dinnersIn.

/** The night a dinner question asks about, or null when the phrase is not a dinner question. */
export function dinnerWord(t: string): 'tonight' | 'tomorrow' | null {
  const m = /^(?:what(?:'s| is) for dinner|what are we having for dinner)( tonight| tomorrow)?$/.exec(t);
  if (!m) return null;
  return m[1] === ' tomorrow' ? 'tomorrow' : 'tonight';
}

/** What the voice says: the dinner planned for that night, or that nothing is planned. */
export function dinnerSay(text: string | null, night: 'tonight' | 'tomorrow'): string {
  if (!text) return `Nothing planned for dinner ${night}.`;
  return `${night === 'tonight' ? 'Tonight' : 'Tomorrow'} it’s ${text.replace(/^./, c => c.toLowerCase())}.`;
}
