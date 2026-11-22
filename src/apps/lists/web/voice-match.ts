// Voice for the Lists app: "add milk to the shopping list", "put bin day on my to-do list", "what's on the camping list".
// Pure (no DOM, no fetch). core/web/voice-commands.ts calls POST /api/lists/add (the same route as typing it on the
// tablet) or GET /api/lists/lists. Shopping, To-do, and the lists the family made (by their names), and only these
// exact shapes: anything else goes to Claude as before.

/** A list id: "shopping", "todo", or a list the family made (its id, as the Lists app keeps it). */
export type VoiceList = string;
export type ListCommand = { op: 'add'; list: VoiceList; text: string } | { op: 'read'; list: VoiceList } | { op: 'tick'; list: VoiceList; text: string }
  | { op: 'remove'; list: VoiceList; text: string } | { op: 'clear'; list: VoiceList };

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

/** A list name as a voice phrase: lower case, letters and digits, single spaces. */
const norm = (s: string): string => s.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The list a spoken name means: Shopping, To-do, or one of the family's own lists (its id). */
function which(w: string, custom: { id: string; name: string }[]): VoiceList {
  if (/^(shopping|grocery|groceries)$/.test(w)) return 'shopping';
  if (/^(to ?do|to-do|todo)$/.test(w)) return 'todo';
  return custom.find(c => norm(c.name) === w)?.id ?? 'todo';
}

/** The command in a phrase, or null. The item keeps the words as said (minus a leading "a", "some"...).
 *  custom: the family's own lists (id and name); their names are heard as list names too. */
export function matchList(raw: string, custom: { id: string; name: string }[] = []): ListCommand | null {
  const t = raw.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(POLITE, '').trim().replace(POLITE, '').trim();
  const names = custom.map(c => norm(c.name)).filter(Boolean).map(esc);
  const LIST = `(?:the |my |our )?(${['shopping', 'grocery', 'groceries', 'to ?do', 'to-do', 'todo', ...names].join('|')}) list`;
  let m = t.match(new RegExp(`^(?:add|put|stick|write) (.+?) (?:to|on|onto|in|into) ${LIST}$`));
  if (m) {
    const text = m[1].replace(/^(?:a|an|some|more) (?=\S)/, '').trim();
    if (!text || text.length > 80 || /^(it|that|this|them)$/.test(text)) return null;
    return { op: 'add', list: which(m[2], custom), text: text.charAt(0).toUpperCase() + text.slice(1) };
  }
  // "tick off milk on the shopping list": the item is looked up by its words on the tablet, not guessed here
  m = t.match(new RegExp(`^(?:tick off|cross off|check off|mark) (.+?) (?:from|on|in) ${LIST}$`));
  if (m) {
    const text = m[1].replace(/^(?:a|an|the|some) (?=\S)/, '').trim();
    if (!text || /^(it|that|this|them)$/.test(text)) return null;
    return { op: 'tick', list: which(m[2], custom), text: text.charAt(0).toUpperCase() + text.slice(1) };
  }
  // "remove milk from the shopping list": looked up by its words on the tablet, like tick off
  m = t.match(new RegExp(`^(?:remove|delete|take) (.+?) (?:from|off) ${LIST}$`));
  if (m) {
    const text = m[1].replace(/^(?:a|an|the|some) (?=\S)/, '').trim();
    if (!text || /^(it|that|this|them)$/.test(text)) return null;
    return { op: 'remove', list: which(m[2], custom), text: text.charAt(0).toUpperCase() + text.slice(1) };
  }
  // "clear the ticked items off the shopping list": the same as the Clear ticked button
  m = t.match(new RegExp(`^(?:clear|empty) (?:the |all |my )?(?:ticked|checked|done|crossed off)(?: off)? items? (?:off|from) ${LIST}$`));
  if (m) return { op: 'clear', list: which(m[1], custom) };
  m = t.match(new RegExp(`^(?:what(?:'s| is) on|read(?: me)?|what do we have on|what do i have on|what(?:'s| is) in) ${LIST}$`));
  if (m) return { op: 'read', list: which(m[1], custom) };
  return null;
}
