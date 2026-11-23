// Shapes of what the Lists app's server routes send to its page, and the limits both sides use.
// Served to the browser: nothing secret lives here (the lists themselves stay in .lists.json on the PC).
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
