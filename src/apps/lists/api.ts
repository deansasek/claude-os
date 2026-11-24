// Shapes of what the Lists app's server routes send to its page, and the limits both sides use.
// Served to the browser: nothing secret lives here (the lists live on the tablet, web/local.ts, and in .lists.json on the PC).
// The page checks these limits only to give quick feedback; the server checks everything again (server/store.ts).

export const MAX_LISTS = 12;
export const MAX_ITEMS = 300;          // per list
export const MAX_TEXT = 80;            // characters per item or note
export const MAX_LIST_NAME = 24;

/** The lists every home starts with; they can't be deleted. */
export const BUILT_IN = ['shopping', 'todo', 'notes'] as const;
export const isBuiltIn = (id: string): boolean => (BUILT_IN as readonly string[]).includes(id);

/** A list id: a lower-case letter, then letters, digits or dashes. */
export const LIST_ID = /^[a-z][a-z0-9-]{0,23}$/;
/** An item id: "i" and a few letters or digits. */
export const ITEM_ID = /^i[a-z0-9]{1,23}$/;

/** 'check': items are ticked off (Shopping, To-do, new lists). 'notes': free text, one note per entry, no ticks. */
export type ListKind = 'check' | 'notes';

export interface ListItem {
  id: string;
  text: string;
  done: boolean;
  at: string;                          // when it was added (ISO)
}

export interface FamilyList {
  id: string;                          // "shopping", "todo", "notes", or one made from a new list's name
  name: string;                        // "Shopping", "To-do", "Notes", "Garden"
  kind: ListKind;
  items: ListItem[];                   // in the order they were added
}

/** What every route answers: all the lists as they are now, and why a change was refused. */
export interface ListsResult {
  ok: boolean;
  lists: FamilyList[];
  error?: string;
  item?: ListItem;                     // add / tick / edit: the item it touched
  list?: string;                       // new-list: the new list's id
  removed?: number;                    // clear-done: how many went
  stored?: boolean;                    // GET lists: the PC has a lists file (false: the tablet may restore its copy)
  retry?: boolean;                     // the PC couldn't read or save its file: send the change again later
}

/** Change one item's text on a list (in place; pure, no file): the changed item, or why not.
 *  The same text on another item is refused, so a list never holds the same thing twice. */
export function renameItem(l: FamilyList, id: unknown, rawText: unknown): ListItem | string {
  if (typeof id !== 'string' || !ITEM_ID.test(id)) return 'That isn’t an item.';
  const it = l.items.find(i => i.id === id);
  if (!it) return `That isn’t on ${l.name}.`;
  const text = cleanText(rawText);
  if (!text) return 'Type the new text.';
  if (text.length > MAX_TEXT) return `That’s too long: ${MAX_TEXT} characters at most.`;
  if (l.items.some(i => i.id !== id && i.text.toLowerCase() === text.toLowerCase())) return `${text} is already on ${l.name}.`;
  it.text = text;
  return it;
}

/** A list id from a name: "Garden jobs" → "garden-jobs"; a different one if that is taken. */
export function idFor(name: string, lists: { id: string }[]): string {
  let base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(base)) base = `l-${base}`.replace(/-+$/, '');
  base = base.slice(0, 20).replace(/-+$/, '') || 'list';
  let id = base, n = 2;
  while (lists.some(l => l.id === id)) id = `${base}-${n++}`;
  return id;
}

/** Plain text: no control characters, single spaces, trimmed (not cut: the server refuses what is too long). */
export function cleanText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Find a list by its id or its name ("shopping", "Shopping", "the shopping list", "to do", "todo"). */
export function findList<T extends { id: string; name: string }>(lists: T[], ref: unknown): T | undefined {
  if (typeof ref !== 'string') return undefined;
  const key = (s: string) => s.toLowerCase().replace(/^(?:the|my|our)\s+/, '').replace(/\s+list$/, '').replace(/[^a-z0-9]+/g, '');
  const want = key(ref.trim());
  if (!want) return undefined;
  return lists.find(l => l.id === ref) ?? lists.find(l => key(l.id) === want || key(l.name) === want);
}
