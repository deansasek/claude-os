// The family lists, kept on the PC in hub/.lists.json (outside src/, so it is never served).
//
// The file is read again for every request and written whole (through a .tmp file), so what the page, Claude's tools
// and a person editing the file see is always the same. Everything that comes in is checked here: the page and Claude
// are never trusted. Limits (api.ts): 12 lists, 300 items a list, 80 characters an item, 24 a list name.
//
// With no file yet, the three built-in lists (Shopping, To-do, Notes) are there, empty; the file is only written
// when something changes. Nothing is made up for the family.
import fs from 'node:fs';
import path from 'node:path';
import { HUB } from '../../../core/server/paths.ts';
import {
  BUILT_IN, ITEM_ID, LIST_ID, MAX_ITEMS, MAX_LIST_NAME, MAX_LISTS, MAX_TEXT, cleanText, findList, isBuiltIn,
  type FamilyList, type ListItem, type ListKind, type ListsResult,
} from '../api.ts';

export const FILE = path.join(HUB, '.lists.json');

const DEFAULTS: FamilyList[] = [
  { id: 'shopping', name: 'Shopping', kind: 'check', items: [] },
  { id: 'todo', name: 'To-do', kind: 'check', items: [] },
  { id: 'notes', name: 'Notes', kind: 'notes', items: [] },
];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

let seq = 0;
const newItemId = (): string => `i${Date.now().toString(36)}${(seq++ % 1296).toString(36)}`.slice(0, 24);

/** A clean copy of one stored list, or null when it isn't one. */
function cleanList(raw: unknown): FamilyList | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !LIST_ID.test(r.id)) return null;
  const name = cleanText(r.name).slice(0, MAX_LIST_NAME).trim();
  if (!name) return null;
  const kind: ListKind = r.kind === 'notes' ? 'notes' : 'check';
  const items: ListItem[] = [];
  const ids = new Set<string>();
  for (const x of Array.isArray(r.items) ? r.items : []) {
    if (items.length >= MAX_ITEMS) break;
    if (!x || typeof x !== 'object') continue;
    const i = x as Record<string, unknown>;
    const text = cleanText(i.text).slice(0, MAX_TEXT).trim();
    if (!text) continue;
    let id = typeof i.id === 'string' && ITEM_ID.test(i.id) ? i.id : newItemId();
    while (ids.has(id)) id = newItemId();
    ids.add(id);
    const at = typeof i.at === 'string' && !Number.isNaN(Date.parse(i.at)) ? i.at : new Date().toISOString();
    items.push({ id, text, done: kind === 'check' && i.done === true, at });
  }
  return { id: r.id, name, kind, items };
}

/** The lists from the file; the defaults when there is no file; null when the file is there but can't be read. */
function load(): FamilyList[] | null {
  let text: string;
  try { text = fs.readFileSync(FILE, 'utf8'); } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? clone(DEFAULTS) : null;
  }
  try {
    const raw = JSON.parse(text.replace(/^﻿/, '')) as { lists?: unknown };
    if (!raw || !Array.isArray(raw.lists)) return null;
    const out: FamilyList[] = [];
    for (const l of raw.lists) {
      if (out.length >= MAX_LISTS) break;
      const c = cleanList(l);
      if (c && !out.some(o => o.id === c.id)) out.push(c);
    }
    // the built-in lists are always there (in front, in their order) even if the file lost one
    for (const d of [...DEFAULTS].reverse()) if (!out.some(o => o.id === d.id)) out.unshift(clone(d));
    return out.slice(0, Math.max(MAX_LISTS, BUILT_IN.length));
  } catch { return null; }
}

function persist(lists: FamilyList[]): boolean {
  try {
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ lists }, null, 1), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, FILE);
    return true;
  } catch (e) {
    console.log('lists: could not save:', (e as NodeJS.ErrnoException).code ?? 'error');
    return false;
  }
}

const UNREADABLE = 'The lists file on the PC couldn’t be read, so nothing was changed.';

/** All the lists. */
export function readLists(): ListsResult {
  const lists = load();
  return lists ? { ok: true, lists } : { ok: false, lists: clone(DEFAULTS), error: UNREADABLE };
}

/** Load, change, save: `fn` returns an error (nothing is saved) or the extra fields of a good answer. */
function change(fn: (lists: FamilyList[]) => string | Partial<ListsResult>): ListsResult {
  const lists = load();
  if (!lists) return { ok: false, lists: clone(DEFAULTS), error: UNREADABLE };
  const before = JSON.stringify(lists);
  const r = fn(lists);
  if (typeof r === 'string') return { ok: false, lists: load() ?? lists, error: r };
  if (JSON.stringify(lists) !== before && !persist(lists)) return { ok: false, lists: load() ?? lists, error: 'The PC couldn’t save the lists.' };
  return { ok: true, lists, ...r };
}

const NO_LIST = 'There’s no list by that name.';

/** Check an item's text: the cleaned text, or why not. */
function itemText(v: unknown): { text: string } | { error: string } {
  const text = cleanText(v);
  if (!text) return { error: 'Type something to add.' };
  if (text.length > MAX_TEXT) return { error: `That’s too long: ${MAX_TEXT} characters at most.` };
  return { text };
}

/** Add an item. The same text already on the list isn't added twice (a ticked one is unticked instead). */
export function addItem(listRef: unknown, rawText: unknown): ListsResult {
  return change(lists => {
    const l = findList(lists, listRef);
    if (!l) return NO_LIST;
    const t = itemText(rawText);
    if ('error' in t) return t.error;
    const same = l.items.find(i => i.text.toLowerCase() === t.text.toLowerCase());
    if (same) { same.done = false; return { item: clone(same) }; }
    if (l.items.length >= MAX_ITEMS) return `${l.name} is full (${MAX_ITEMS} items). Clear the ticked ones or remove some first.`;
    const item: ListItem = { id: newItemId(), text: t.text, done: false, at: new Date().toISOString() };
    while (l.items.some(i => i.id === item.id)) item.id = newItemId();
    l.items.push(item);
    return { item: clone(item) };
  });
}

/** Find an item by id, or by its text (exactly, then a single unticked or single item containing it). */
export function findItem(l: FamilyList, ref: { id?: unknown; text?: unknown }): ListItem | undefined | 'many' {
  if (typeof ref.id === 'string' && ref.id) return l.items.find(i => i.id === ref.id);
  const want = cleanText(ref.text).toLowerCase();
  if (!want) return undefined;
  const exact = l.items.find(i => i.text.toLowerCase() === want);
  if (exact) return exact;
  const hits = l.items.filter(i => i.text.toLowerCase().includes(want));
  if (hits.length === 1) return hits[0];
  const open = hits.filter(i => !i.done);
  if (open.length === 1) return open[0];
  return hits.length ? 'many' : undefined;
}

/** Tick an item off (done: true) or back on (done: false). */
export function tickItem(listRef: unknown, ref: { id?: unknown; text?: unknown }, done: boolean): ListsResult {
  return change(lists => {
    const l = findList(lists, listRef);
    if (!l) return NO_LIST;
    if (l.kind !== 'check') return `${l.name} holds notes, which aren’t ticked off.`;
    const it = findItem(l, ref);
    if (it === 'many') return `More than one item on ${l.name} matches that. Use the exact text.`;
    if (!it) return `That isn’t on ${l.name}.`;
    it.done = done;
    return { item: clone(it) };
  });
}

/** Remove one item. */
export function removeItem(listRef: unknown, id: unknown): ListsResult {
  return change(lists => {
    const l = findList(lists, listRef);
    if (!l) return NO_LIST;
    if (typeof id !== 'string' || !ITEM_ID.test(id)) return 'That isn’t an item.';
    const at = l.items.findIndex(i => i.id === id);
    if (at < 0) return { removed: 0 };   // already gone (someone else removed it): fine
    l.items.splice(at, 1);
    return { removed: 1 };
  });
}

/** Remove every ticked item from a list. */
export function clearDone(listRef: unknown): ListsResult {
  return change(lists => {
    const l = findList(lists, listRef);
    if (!l) return NO_LIST;
    const n = l.items.filter(i => i.done).length;
    l.items = l.items.filter(i => !i.done);
    return { removed: n };
  });
}

/** A list id from a name: "Garden jobs" → "garden-jobs"; a different one if that is taken. */
function idFor(name: string, lists: FamilyList[]): string {
  let base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(base)) base = `l-${base}`.replace(/-+$/, '');
  base = base.slice(0, 20).replace(/-+$/, '') || 'list';
  let id = base, n = 2;
  while (lists.some(l => l.id === id)) id = `${base}-${n++}`;
  return id;
}

/** Make a new (tick-off) list. */
export function newList(rawName: unknown): ListsResult {
  return change(lists => {
    const name = cleanText(rawName);
    if (!name) return 'Give the list a name.';
    if (name.length > MAX_LIST_NAME) return `That name is too long: ${MAX_LIST_NAME} characters at most.`;
    if (findList(lists, name)) return `There’s already a list called ${name}.`;
    if (lists.length >= MAX_LISTS) return `There are already ${MAX_LISTS} lists. Delete one first.`;
    const id = idFor(name, lists);
    if (!LIST_ID.test(id)) return 'That name can’t be used.';
    lists.push({ id, name, kind: 'check', items: [] });
    return { list: id };
  });
}

/** Delete a list the family made (Shopping, To-do and Notes stay). */
export function deleteList(listRef: unknown): ListsResult {
  return change(lists => {
    const l = findList(lists, listRef);
    if (!l) return NO_LIST;
    if (isBuiltIn(l.id)) return `${l.name} is one of the built-in lists and can’t be deleted.`;
    lists.splice(lists.indexOf(l), 1);
    return { list: l.id };
  });
}
