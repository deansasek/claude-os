// Lists app routes (all under /api/lists/). Every answer is a ListsResult: {ok, lists, error?, ...}.
//   GET  lists        all the lists and their items
//   POST add          {list, text}           list: its id or name; text: up to 80 characters
//   POST tick         {list, id, done}       done: true ticks it off, false puts it back
//   POST remove       {list, id}
//   POST clear-done   {list}                 removes the ticked items
//   POST new-list     {name}                 a new tick-off list (12 lists at most)
//   POST delete-list  {list}                 a list the family made (Shopping, To-do and Notes stay)
// Kept in .lists.json on the PC (server/store.ts), where everything is checked again.
import type { ServerApp } from '../../../core/server/app.ts';
import { manifest } from '../manifest.ts';
import { addItem, clearDone, deleteList, newList, readLists, removeItem, tickItem } from './store.ts';
import { suggestions } from './history.ts';
import { findList } from '../api.ts';

const b = (body: unknown): Record<string, unknown> => (body && typeof body === 'object' ? body as Record<string, unknown> : {});

const app: ServerApp = {
  id: manifest.id,
  routes: [
    { method: 'GET', path: 'lists', handle: () => readLists() },
    { method: 'POST', path: 'add', handle: ({ body }) => addItem(b(body).list, b(body).text) },
    { method: 'POST', path: 'tick', handle: ({ body }) => tickItem(b(body).list, { id: b(body).id }, b(body).done !== false) },
    { method: 'POST', path: 'remove', handle: ({ body }) => removeItem(b(body).list, b(body).id) },
    { method: 'POST', path: 'clear-done', handle: ({ body }) => clearDone(b(body).list) },
    // what the family often buys and is not on this list now (history.ts): offered as tap-to-add suggestions
    { method: 'GET', path: 'suggest', handle: ({ query }) => {
      const r = readLists();
      const l = findList(r.lists, query.get('list') ?? '');
      return { items: suggestions(l ? l.items.map(i => i.text) : []) };
    } },
    { method: 'POST', path: 'new-list', handle: ({ body }) => newList(b(body).name) },
    { method: 'POST', path: 'delete-list', handle: ({ body }) => deleteList(b(body).list) },
  ],
};
export default app;
