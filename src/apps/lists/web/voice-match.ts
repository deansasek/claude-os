// Voice for the Lists app: "add milk to the shopping list", "put bin day on my to-do list", "what's on the shopping list".
// Pure (no DOM, no fetch). core/web/voice-commands.ts calls POST /api/lists/add (the same route as typing it on the
// tablet) or GET /api/lists/lists. Only the Shopping and To-do lists, and only these exact shapes: anything else
// goes to Claude as before.

export type VoiceList = 'shopping' | 'todo';
export type ListCommand = { op: 'add'; list: VoiceList; text: string } | { op: 'read'; list: VoiceList } | { op: 'tick'; list: VoiceList; text: string }
  | { op: 'remove'; list: VoiceList; text: string };

/** Find one item by its words: the exact text, or the only partial match. Never a guess between several.
 *  open: only items not yet ticked. ambiguous: more than one partial match and no exact one. */
export function pickItem<T extends { text: string; done: boolean }>(items: T[], want: string, open: boolean): { hit?: T; ambiguous: boolean } {
  const pool = open ? items.filter(i => !i.done) : items;
  const w = want.toLowerCase();
  const exact = pool.find(i => i.text.toLowerCase() === w);
  const partial = pool.filter(i => i.text.toLowerCase().includes(w));
  const hit = exact ?? (partial.length === 1 ? partial[0] : undefined);
  return { hit, ambiguous: !hit && partial.length > 1 };
}

const POLITE = /^(?:(?:can|could|would|will) you |please |hey |ok |okay |claude )+|(?: please| thanks| thank you)+$/g;
const LIST = '(?:the |my |our )?(shopping|grocery|groceries|to ?do|to-do|todo) list';

const which = (w: string): VoiceList => (/^(shopping|grocery|groceries)$/.test(w) ? 'shopping' : 'todo');

/** The command in a phrase, or null. The item keeps the words as said (minus a leading "a", "some"...). */
export function matchList(raw: string): ListCommand | null {
  const t = raw.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(POLITE, '').trim().replace(POLITE, '').trim();
  let m = t.match(new RegExp(`^(?:add|put|stick|write) (.+?) (?:to|on|onto|in|into) ${LIST}$`));
  if (m) {
    const text = m[1].replace(/^(?:a|an|some|more) (?=\S)/, '').trim();
    if (!text || text.length > 80 || /^(it|that|this|them)$/.test(text)) return null;
    return { op: 'add', list: which(m[2]), text: text.charAt(0).toUpperCase() + text.slice(1) };
  }
  // "tick off milk on the shopping list": the item is looked up by its words on the tablet, not guessed here
  m = t.match(new RegExp(`^(?:tick off|cross off|check off|mark) (.+?) (?:from|on|in) ${LIST}$`));
  if (m) {
    const text = m[1].replace(/^(?:a|an|the|some) (?=\S)/, '').trim();
    if (!text || /^(it|that|this|them)$/.test(text)) return null;
    return { op: 'tick', list: which(m[2]), text: text.charAt(0).toUpperCase() + text.slice(1) };
  }
  // "remove milk from the shopping list": looked up by its words on the tablet, like tick off
  m = t.match(new RegExp(`^(?:remove|delete|take) (.+?) (?:from|off) ${LIST}$`));
  if (m) {
    const text = m[1].replace(/^(?:a|an|the|some) (?=\S)/, '').trim();
    if (!text || /^(it|that|this|them)$/.test(text)) return null;
    return { op: 'remove', list: which(m[2]), text: text.charAt(0).toUpperCase() + text.slice(1) };
  }
  m = t.match(new RegExp(`^(?:what(?:'s| is) on|read(?: me)?|what do we have on|what do i have on|what(?:'s| is) in) ${LIST}$`));
  if (m) return { op: 'read', list: which(m[1]) };
  return null;
}
