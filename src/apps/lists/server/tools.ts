// Claude's Lists tools, as one in-process MCP server (claudeos_lists) that turns.ts adds to each session.
// Each call is an ordinary tool call, so it goes through canUseTool (the approval card on the tablet) first.
// They use the same store, and so the same checks and limits, as the tablet's own taps (server/store.ts).
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { MAX_TEXT, findList, type FamilyList, type ListsResult } from '../api.ts';
import { addItem, readLists, tickItem } from './store.ts';

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) });

const names = (r: ListsResult) => r.lists.map(l => l.name).join(', ');

function show(l: FamilyList): string {
  if (!l.items.length) return `${l.name} (id ${l.id}): empty.`;
  const rows = l.items.map(i => (l.kind === 'notes' ? `- ${i.text}` : `- [${i.done ? 'x' : ' '}] ${i.text}`) + ` (id ${i.id})`);
  const open = l.items.filter(i => !i.done).length;
  const head = l.kind === 'notes' ? `${l.name} (id ${l.id}, notes): ${l.items.length}` : `${l.name} (id ${l.id}): ${open} to do, ${l.items.length - open} ticked`;
  return `${head}\n${rows.join('\n')}`;
}

export const listsServer = createSdkMcpServer({
  name: 'claudeos_lists',
  version: '1.0.0',
  tools: [
    tool('lists_read',
      'Read the family’s shared lists on the ClaudeOS tablet (Shopping, To-do, Notes, and any the family made). Read-only. '
        + 'list: a list’s name or id, or "all" (the default) for every list. Ticked items are marked [x].',
      { list: z.string().max(40).optional() },
      async ({ list }) => {
        const r = readLists();
        if (!r.ok) return text(r.error ?? 'Couldn’t read the lists.', true);
        if (!list || /^all$/i.test(list.trim())) return text(r.lists.map(show).join('\n\n'));
        const l = findList(r.lists, list);
        return l ? text(show(l)) : text(`There’s no list called “${list}”. The lists are: ${names(r)}.`, true);
      }),
    tool('lists_add',
      `Add one item to a family list on the ClaudeOS tablet, e.g. milk to Shopping. list: its name or id (shopping, todo, notes, ...). `
        + `text: the item or note, up to ${MAX_TEXT} characters. Call once per item. An item already there isn’t added twice.`,
      { list: z.string().max(40), text: z.string().max(400) },
      async ({ list, text: t }) => {
        const r = addItem(list, t);
        if (!r.ok) return text(`${r.error ?? 'That didn’t work.'}${/no list/.test(r.error ?? '') ? ` The lists are: ${names(r)}.` : ''}`, true);
        const l = findList(r.lists, list);
        return text(`Done. “${r.item?.text}” is on ${l?.name ?? list}${l ? ` (${l.items.filter(i => !i.done).length} to do)` : ''}.`);
      }),
    tool('lists_tick',
      'Tick an item off a family list on the ClaudeOS tablet (or put it back with done: false). list: its name or id. '
        + 'Give the item’s id (from lists_read) or its text. Notes can’t be ticked.',
      { list: z.string().max(40), id: z.string().max(40).optional(), text: z.string().max(400).optional(), done: z.boolean().optional() },
      async ({ list, id, text: t, done }) => {
        if (!id && !t) return text('Say which item: its id or its text.', true);
        const r = tickItem(list, id ? { id } : { text: t }, done !== false);
        if (!r.ok) return text(r.error ?? 'That didn’t work.', true);
        return text(`Done. “${r.item?.text}” is ${r.item?.done ? 'ticked off' : 'back on the list'}.`);
      }),
  ],
});
