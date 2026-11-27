// Lists in the mock page (no hub): the three built-in lists with a few items, and a session store, so adding,
// ticking, editing, removing and new lists work and show up on the next read. Nothing is saved after a reload.
// The shapes are the ones in ../api.ts.
import { defineMock } from '../../../core/web/mock-api.ts';
import { BUILT_IN, type FamilyList, type ListItem, type ListsResult, renameItem, restoreItemAt } from '../api.ts';

const now = (): string => new Date().toISOString();
const item = (id: string, text: string, done = false): ListItem => ({ id, text, done, at: now() });

const lists: FamilyList[] = [
  { id: 'shopping', name: 'Shopping', kind: 'check', items: [item('i1', 'Milk'), item('i2', 'Bread', true)] },
  { id: 'todo', name: 'To-do', kind: 'check', items: [item('i3', 'Call the plumber')] },
  { id: 'notes', name: 'Notes', kind: 'notes', items: [item('i4', 'Sample note')] },
];

const reply = (extra: Partial<ListsResult> = {}): ListsResult => ({ ok: true, lists, stored: true, ...extra });
const fail = (error: string): ListsResult => ({ ok: false, lists, error });
const find = (id: unknown): FamilyList | undefined => lists.find(l => l.id === id);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const newId = (): string => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

defineMock({
  'GET /api/lists/lists': (): ListsResult => reply(),
  'POST /api/lists/add': ({ body }): ListsResult => {
    const b = body as { list?: unknown; text?: unknown; id?: unknown };
    const l = find(b.list);
    if (!l) return fail('That list isn’t here.');
    const t = text(b.text);
    if (!t) return fail('Type the item text.');
    if (l.items.some(i => i.text.toLowerCase() === t.toLowerCase())) return fail(`${t} is already on ${l.name}.`);
    const it = item(typeof b.id === 'string' ? b.id : newId(), t);
    l.items.push(it);
    return reply({ item: it });
  },
  'POST /api/lists/tick': ({ body }): ListsResult => {
    const b = body as { list?: unknown; id?: unknown; done?: unknown };
    const l = find(b.list);
    const it = l?.items.find(i => i.id === b.id);
    if (!l || !it) return fail('That isn’t on the list.');
    it.done = b.done !== false && l.kind === 'check';
    return reply({ item: it });
  },
  'POST /api/lists/remove': ({ body }): ListsResult => {
    const b = body as { list?: unknown; id?: unknown };
    const l = find(b.list);
    if (!l) return fail('That list isn’t here.');
    l.items = l.items.filter(i => i.id !== b.id);
    return reply();
  },
  'POST /api/lists/restore-item': ({ body }): ListsResult => {
    const b = body as { list?: unknown; item?: unknown; index?: unknown };
    const l = find(b.list);
    if (!l) return fail('That list isn’t here.');
    const r = restoreItemAt(l, b.item, b.index);
    return typeof r === 'string' ? fail(r) : reply({ item: r });
  },
  'POST /api/lists/edit': ({ body }): ListsResult => {
    const b = body as { list?: unknown; id?: unknown; text?: unknown };
    const l = find(b.list);
    if (!l) return fail('That list isn’t here.');
    const r = renameItem(l, b.id, b.text);
    return typeof r === 'string' ? fail(r) : reply({ item: r });
  },
  'POST /api/lists/untick-all': ({ body }): ListsResult => {
    const l = find((body as { list?: unknown } | null)?.list);
    if (!l) return fail('That list isn’t here.');
    const n = l.items.filter(i => i.done).length;
    for (const i of l.items) i.done = false;
    return reply({ unticked: n });
  },
  'POST /api/lists/clear-done': ({ body }): ListsResult => {
    const l = find((body as { list?: unknown } | null)?.list);
    if (!l) return fail('That list isn’t here.');
    const before = l.items.length;
    l.items = l.items.filter(i => !i.done);
    return reply({ removed: before - l.items.length });
  },
  'GET /api/lists/suggest': () => ({ items: [] as string[] }),
  'POST /api/lists/new-list': ({ body }): ListsResult => {
    const name = text((body as { name?: unknown } | null)?.name);
    if (!name) return fail('Type a name for the list.');
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(?=[^a-z])/, 'l') || 'list';
    if (find(id)) return fail(`${name} is already a list.`);
    lists.push({ id, name, kind: 'check', items: [] });
    return reply({ list: id });
  },
  'POST /api/lists/rename-list': ({ body }): ListsResult => {
    const { list, name } = (body ?? {}) as { list?: string; name?: string };
    const l = lists.find(x => x.id === list);
    if (!l) return fail('That list isn’t here.');
    if ((BUILT_IN as readonly string[]).includes(l.id)) return fail('That list can’t be renamed.');
    const clean = (name ?? '').trim();
    if (!clean) return fail('Give the list a name.');
    if (lists.some(x => x !== l && x.name.toLowerCase() === clean.toLowerCase())) return fail(`There’s already a list called ${clean}.`);
    l.name = clean;
    return reply({ list: l.id });
  },
  'POST /api/lists/delete-list': ({ body }): ListsResult => {
    const id = (body as { list?: unknown } | null)?.list;
    if (typeof id === 'string' && (BUILT_IN as readonly string[]).includes(id)) return fail('That list can’t be deleted.');
    const i = lists.findIndex(l => l.id === id);
    if (i < 0) return fail('That list isn’t here.');
    lists.splice(i, 1);
    return reply();
  },
  'POST /api/lists/restore': ({ body }): ListsResult => {
    const saved = (body as { lists?: unknown } | null)?.lists;
    if (Array.isArray(saved)) for (const l of saved as FamilyList[]) if (l && !find(l.id)) lists.push(l);
    return reply();
  },
});
