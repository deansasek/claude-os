// The tablet's own copy of the lists (docs/specs/pc-hub-retirement.md, step 1). Pure: no DOM, no fetch, no storage.
// A change applies here first (applyOp) and waits in a queue; the page sends the queue to the PC in order when the PC
// answers (web/index.ts flush), then takes the PC's lists, which also hold what Claude changed there meanwhile.
// The rules match the PC's (server/store.ts), which checks every change again.
import {
  ITEM_ID, LIST_ID, MAX_ITEMS, MAX_LIST_NAME, MAX_LISTS, MAX_TEXT, cleanText, findList, idFor, isBuiltIn, renameItem,
  type FamilyList, type ListItem, type ListsResult,
} from '../api.ts';

/** The localStorage key of the tablet's copy of the lists. Read by the Lists page and by readers.ts. */
export const COPY_KEY = 'lists.copy';

export type OpPath = 'add' | 'tick' | 'remove' | 'edit' | 'clear-done' | 'new-list' | 'delete-list';
/** One change, as the route and body the PC takes (server/index.ts). */
export interface Op { path: OpPath; body: Record<string, unknown> }

/** A new item id, made on the tablet; the PC keeps it when it is free (server/store.ts addItem). */
export const newItemId = (): string => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Apply one change to a copy of the lists. Fills in op.body.id for add and new-list, so the PC uses the same id. */
export function applyOp(lists: FamilyList[], op: Op): ListsResult {
  const next = JSON.parse(JSON.stringify(lists)) as FamilyList[];
  const b = op.body;
  const fail = (error: string): ListsResult => ({ ok: false, lists, error });
  if (op.path === 'new-list') {
    const name = cleanText(b.name);
    if (!name) return fail('Give the list a name.');
    if (name.length > MAX_LIST_NAME) return fail(`That name is too long: ${MAX_LIST_NAME} characters at most.`);
    if (findList(next, name)) return fail(`There’s already a list called ${name}.`);
    if (next.length >= MAX_LISTS) return fail(`There are already ${MAX_LISTS} lists. Delete one first.`);
    const id = typeof b.id === 'string' && LIST_ID.test(b.id) && !next.some(l => l.id === b.id) ? b.id : idFor(name, next);
    if (!LIST_ID.test(id)) return fail('That name can’t be used.');
    next.push({ id, name, kind: 'check', items: [] });
    b.id = id;
    return { ok: true, lists: next, list: id };
  }
  const l = findList(next, b.list);
  if (!l) return fail('There’s no list by that name.');
  switch (op.path) {
    case 'add': {
      const text = cleanText(b.text);
      if (!text) return fail('Type something to add.');
      if (text.length > MAX_TEXT) return fail(`That’s too long: ${MAX_TEXT} characters at most.`);
      const same = l.items.find(i => i.text.toLowerCase() === text.toLowerCase());
      if (same) { same.done = false; b.id = same.id; return { ok: true, lists: next, item: same }; }
      if (l.items.length >= MAX_ITEMS) return fail(`${l.name} is full (${MAX_ITEMS} items). Clear the ticked ones or remove some first.`);
      const free = typeof b.id === 'string' && ITEM_ID.test(b.id) && !l.items.some(i => i.id === b.id);
      const item: ListItem = { id: free ? b.id as string : newItemId(), text, done: false, at: new Date().toISOString() };
      l.items.push(item);
      b.id = item.id;
      return { ok: true, lists: next, item };
    }
    case 'tick': {
      if (l.kind !== 'check') return fail(`${l.name} holds notes, which aren’t ticked off.`);
      const it = l.items.find(i => i.id === b.id);
      if (!it) return fail(`That isn’t on ${l.name}.`);
      it.done = b.done !== false;
      return { ok: true, lists: next, item: it };
    }
    case 'remove': {
      const n = l.items.length;
      l.items = l.items.filter(i => i.id !== b.id);
      return { ok: true, lists: next, removed: n - l.items.length };
    }
    case 'edit': {
      const r = renameItem(l, b.id, b.text);
      return typeof r === 'string' ? fail(r) : { ok: true, lists: next, item: r };
    }
    case 'clear-done': {
      const n = l.items.length;
      l.items = l.items.filter(i => !i.done);
      return { ok: true, lists: next, removed: n - l.items.length };
    }
    case 'delete-list':
      if (isBuiltIn(l.id)) return fail(`${l.name} is one of the built-in lists and can’t be deleted.`);
      next.splice(next.indexOf(l), 1);
      return { ok: true, lists: next, list: l.id };
  }
}

/** The PC gave an item or list another id than the tablet's (the same text was already there): later changes use the PC's. */
export function remapIds(queue: Op[], key: 'id' | 'list', from: unknown, to: string): void {
  for (const op of queue) if (op.body[key] === from) op.body[key] = to;
}
