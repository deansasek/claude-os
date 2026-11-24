// Lists app routes (all under /api/lists/). Every answer is a ListsResult: {ok, lists, error?, ...}.
//   GET  lists        all the lists and their items; stored: false when the PC has no lists file yet
//   POST add          {list, text, id?}      list: its id or name; text: up to 80 characters; id: the tablet's, if free
//   POST tick         {list, id, done}       done: true ticks it off, false puts it back
//   POST remove       {list, id}
//   POST edit         {list, id, text}       new text, up to 80 characters; the id and the tick stay
//   POST clear-done   {list}                 removes the ticked items
//   POST new-list     {name, id?}            a new tick-off list (12 lists at most); id: the tablet's, if free
//   POST delete-list  {list}                 a list the family made (Shopping, To-do and Notes stay)
//   POST restore      {lists}                the tablet's copy, only when the PC has no lists file
// The tablet keeps the lists and sends its changes here (web/local.ts); Claude's tools change them here too.
// Kept in .lists.json on the PC (server/store.ts), where everything is checked again.
import type { ServerApp } from '../../../core/server/app.ts';
import { manifest } from '../manifest.ts';
import { addItem, clearDone, deleteList, editItem, newList, readLists, removeItem, restoreLists, tickItem } from './store.ts';
import { suggestions } from './history.ts';
import { findList } from '../api.ts';

const b = (body: unknown): Record<string, unknown> => (body && typeof body === 'object' ? body as Record<string, unknown> : {});

const app: ServerApp = {
  id: manifest.id,
  routes: [
    { method: 'GET', path: 'lists', handle: () => readLists() },
    { method: 'POST', path: 'add', handle: ({ body }) => addItem(b(body).list, b(body).text, b(body).id) },
    { method: 'POST', path: 'tick', handle: ({ body }) => tickItem(b(body).list, { id: b(body).id }, b(body).done !== false) },
    { method: 'POST', path: 'remove', handle: ({ body }) => removeItem(b(body).list, b(body).id) },
    { method: 'POST', path: 'edit', handle: ({ body }) => editItem(b(body).list, b(body).id, b(body).text) },
    { method: 'POST', path: 'clear-done', handle: ({ body }) => clearDone(b(body).list) },
    // what the family often buys and is not on this list now (history.ts): offered as tap-to-add suggestions
    { method: 'GET', path: 'suggest', handle: ({ query }) => {
      const r = readLists();
      const l = findList(r.lists, query.get('list') ?? '');
      return { items: suggestions(l ? l.items.map(i => i.text) : []) };
    } },
    { method: 'POST', path: 'new-list', handle: ({ body }) => newList(b(body).name, b(body).id) },
    { method: 'POST', path: 'delete-list', handle: ({ body }) => deleteList(b(body).list) },
    { method: 'POST', path: 'restore', handle: ({ body }) => restoreLists(b(body).lists) },
  ],
};
export default app;
