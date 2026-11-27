// Voice for the Lists app: "add milk to the shopping list", "put bin day on my to-do list", "what's on the camping list".
// Pure (no DOM, no fetch). core/web/voice-commands.ts calls POST /api/lists/add (the same route as typing it on the
// tablet) or GET /api/lists/lists. Shopping, To-do, and the lists the family made (by their names), and only these
// exact shapes: anything else goes to Claude as before.

/** A list id: "shopping", "todo", or a list the family made (its id, as the Lists app keeps it). */
export type VoiceList = string;
export type ListCommand = { op: 'add'; list: VoiceList; text: string } | { op: 'read'; list: VoiceList } | { op: 'tick'; list: VoiceList; text: string }
  | { op: 'remove'; list: VoiceList; text: string } | { op: 'clear'; list: VoiceList }
  | { op: 'addMany'; list: VoiceList; texts: string[] }
  | { op: 'edit'; list: VoiceList | null; text: string; to: string };   // list null: no list was said (see findExact)

/** Every item whose text is exactly these words (any case), on any list: for "change milk to oat milk" with no list said. */
export function findExact<L extends { id: string; items: { id: string; text: string }[] }>(lists: L[], want: string): { list: L; item: L['items'][number] }[] {
  const w = want.toLowerCase();
  return lists.flatMap(list => list.items.filter(i => i.text.toLowerCase() === w).map(item => ({ list, item })));
}

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
/** A family list's name as the voice says it, without a trailing "list": "Packing list" is heard as "packing", so "the packing list" matches once. */
const stem = (s: string): string => norm(s).replace(/ list$/, '');
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The list a spoken name means: Shopping, To-do, or one of the family's own lists (its id). */
function which(w: string, custom: { id: string; name: string }[]): VoiceList {
  if (/^(shopping|grocery|groceries)$/.test(w)) return 'shopping';
  if (/^(to ?do|to-do|todo)$/.test(w)) return 'todo';
  return custom.find(c => stem(c.name) === w)?.id ?? 'todo';
}

/** The command in a phrase, or null. The item keeps the words as said (minus a leading "a", "some"...).
 *  custom: the family's own lists (id and name); their names are heard as list names too. */
export function matchList(raw: string, custom: { id: string; name: string }[] = []): ListCommand | null {
  // commas become the word "comma" before the text is cleaned (the cleaning would drop them), so a list of items keeps its breaks
  const hadComma = raw.includes(',');
  const t = raw.replace(/\s*,[\s,]*/g, ' comma ').toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(POLITE, '').trim().replace(POLITE, '').trim();
  const names = custom.map(c => stem(c.name)).filter(Boolean).map(esc);
  const LIST = `(?:the |my |our )?(${['shopping', 'grocery', 'groceries', 'to ?do', 'to-do', 'todo', ...names].join('|')}) list`;
  let m = t.match(new RegExp(`^(?:add|put|stick|write) (.+?) (?:to|on|onto|in|into) ${LIST}$`));
  if (m) {
    const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
    const clean = (s: string): string => s.replace(/^(?:a|an|some|more) (?=\S)/, '').trim();
    // several items only when the words have a comma: "milk, eggs and bread". "milk and eggs" stays one item (and so does "mac and cheese").
    const parts = hadComma ? m[1].replace(/\s+comma$/, '').split(/\s+comma\s+(?:and\s+)?|\s+and\s+/).map(clean).filter(Boolean) : [clean(m[1])];
    if (!parts.length || parts.length > 10 || parts.some(p => p.length > 80 || /^(it|that|this|them)$/.test(p))) return null;
    const list = which(m[2], custom);
    if (parts.length > 1) return { op: 'addMany', list, texts: parts.map(cap) };
    return { op: 'add', list, text: cap(parts[0]) };
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
  // "change milk to oat milk (on the shopping list)", "rename milk to oat milk": the old item is looked up on the tablet.
  // With no list said, only an item with exactly those words on some list is changed (voice-commands.ts); else Claude gets it.
  m = t.match(new RegExp(`^(?:change|rename) (.+?) to (.+?) (?:on|in) ${LIST}$`)) ?? t.match(/^(?:change|rename) (.+?) to (.+)$/);
  if (m) {
    const from = m[1].replace(/^(?:a|an|the|some|my|our) (?=\S)/, '').trim();
    const to = m[2].replace(/^(?:a|an|some) (?=\S)/, '').trim();
    if (!from || !to || to.length > 80 || /^(it|that|this|them)$/.test(from) || /\blist$/.test(from) || /\blist$/.test(to)) return null;
    const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
    return { op: 'edit', list: m[3] ? which(m[3], custom) : null, text: cap(from), to: cap(to) };
  }
  // "clear the ticked items off the shopping list": the same as the Clear ticked button
  m = t.match(new RegExp(`^(?:clear|empty) (?:the |all |my )?(?:ticked|checked|done|crossed off)(?: off)? items? (?:off|from) ${LIST}$`));
  if (m) return { op: 'clear', list: which(m[1], custom) };
  m = t.match(new RegExp(`^(?:what(?:'s| is) on|read(?: me)?|what do we have on|what do i have on|what(?:'s| is) in) ${LIST}$`));
  if (m) return { op: 'read', list: which(m[1], custom) };
  return null;
}

/** What the voice says after several items were added: how many went, and how many wait for the PC to be back. */
export function addManyReply(texts: string[], ok: number, waiting: number, name: string): string {
  const words = texts.map(t => t.replace(/^./, ch => ch.toLowerCase()));
  const n = words.length;
  if (waiting === 0) {
    const said = n === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[n - 1]}`;
    return ok === n ? `Added ${said} to ${name}.` : `Added ${ok} of ${n} to ${name}.`;
  }
  if (ok === 0) return `I can’t reach ${name} right now. ${n === 1 ? 'It' : `The ${n} items`} will be added when the PC is back.`;
  return `Added ${ok} of ${n} to ${name}. The other ${waiting === 1 ? 'one' : waiting} will be added when the PC is back.`;
}
