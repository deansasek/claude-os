// Voice for the Lists app: "add milk to the shopping list", "put bin day on my to-do list", "what's on the shopping list".
// Pure (no DOM, no fetch). core/web/voice-commands.ts calls POST /api/lists/add (the same route as typing it on the
// tablet) or GET /api/lists/lists. Only the Shopping and To-do lists, and only these exact shapes: anything else
// goes to Claude as before.

export type VoiceList = 'shopping' | 'todo';
export type ListCommand = { op: 'add'; list: VoiceList; text: string } | { op: 'read'; list: VoiceList };

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
  m = t.match(new RegExp(`^(?:what(?:'s| is) on|read(?: me)?|what do we have on|what do i have on|what(?:'s| is) in) ${LIST}$`));
  if (m) return { op: 'read', list: which(m[1]) };
  return null;
}
