// The tablet's own copy of the lists (web/local.ts) and the PC routes it syncs through (server/store.ts). Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import type { FamilyList } from '../src/apps/lists/api.ts';
import { applyOp, remapIds, type Op } from '../src/apps/lists/web/local.ts';

// The store reads its file path when it loads, so the scratch file is set before the import.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-local-'));
process.env.CLAUDEOS_LISTS_FILE = path.join(dir, 'lists.json');
process.env.CLAUDEOS_LISTS_HISTORY = path.join(dir, 'history.json');
const S = await import('../src/apps/lists/server/store.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const start = (): FamilyList[] => [
  { id: 'shopping', name: 'Shopping', kind: 'check', items: [{ id: 'i1', text: 'Milk', done: false, at: '2026-01-01T00:00:00.000Z' }] },
  { id: 'todo', name: 'To-do', kind: 'check', items: [] },
  { id: 'notes', name: 'Notes', kind: 'notes', items: [] },
];

test('a change applies to a copy and gives add and new-list an id for the PC', () => {
  const lists = start();
  const add: Op = { path: 'add', body: { list: 'shopping', text: ' Eggs ' } };
  const r = applyOp(lists, add);
  assert.equal(r.ok, true);
  assert.equal(lists[0].items.length, 1);                       // the input is not changed
  assert.equal(r.lists[0].items[1].text, 'Eggs');
  assert.equal(add.body.id, r.item?.id);
  const made: Op = { path: 'new-list', body: { name: 'Garden jobs' } };
  assert.equal(applyOp(r.lists, made).list, 'garden-jobs');
  assert.equal(made.body.id, 'garden-jobs');
});

test('the same rules as the PC: duplicates, ticks, notes and the built-in lists', () => {
  const lists = start();
  const again: Op = { path: 'add', body: { list: 'shopping', text: 'milk' } };
  assert.equal(applyOp(lists, again).lists[0].items.length, 1);
  assert.equal(again.body.id, 'i1');
  assert.equal(applyOp(lists, { path: 'tick', body: { list: 'shopping', id: 'i1', done: true } }).item?.done, true);
  assert.equal(applyOp(lists, { path: 'tick', body: { list: 'notes', id: 'i1' } }).ok, false);
  assert.equal(applyOp(lists, { path: 'delete-list', body: { list: 'todo' } }).ok, false);
  assert.equal(applyOp(lists, { path: 'add', body: { list: 'nope', text: 'x' } }).ok, false);
  assert.equal(applyOp(lists, { path: 'edit', body: { list: 'shopping', id: 'i1', text: 'Oat milk' } }).item?.text, 'Oat milk');
  const ticked = applyOp(lists, { path: 'tick', body: { list: 'shopping', id: 'i1', done: true } }).lists;
  assert.equal(applyOp(ticked, { path: 'clear-done', body: { list: 'shopping' } }).removed, 1);
});

test('remapIds points later changes at the PC id', () => {
  const q: Op[] = [{ path: 'tick', body: { list: 'shopping', id: 'iabc' } }, { path: 'add', body: { list: 'camp', text: 'Tent' } }];
  remapIds(q, 'id', 'iabc', 'i1');
  remapIds(q, 'list', 'camp', 'camp-2');
  assert.equal(q[0].body.id, 'i1');
  assert.equal(q[1].body.list, 'camp-2');
});

test('the PC keeps the tablet ids, and a queue made offline lands on top of what Claude changed', () => {
  assert.equal(S.readLists().stored, false);
  assert.equal(S.restoreLists(start()).ok, true);               // no file: the tablet's copy goes there
  assert.equal(S.readLists().stored, true);
  assert.equal(S.restoreLists([]).ok, false);                   // a file is there now: never replaced
  // offline on the tablet: add Eggs, tick it, make Camping
  let copy = start();
  const queue: Op[] = [
    { path: 'add', body: { list: 'shopping', text: 'Eggs' } },
    { path: 'new-list', body: { name: 'Camping' } },
  ];
  copy = applyOp(copy, queue[0]).lists;
  copy = applyOp(copy, queue[1]).lists;
  queue.push({ path: 'tick', body: { list: 'shopping', id: queue[0].body.id, done: true } });
  // meanwhile Claude adds Bread on the PC
  assert.equal(S.addItem('shopping', 'Bread').ok, true);
  // the PC is back: the queue is sent in order through the same functions as the routes
  assert.equal(S.addItem('shopping', 'Eggs', queue[0].body.id).item?.id, queue[0].body.id);
  assert.equal(S.newList('Camping', queue[1].body.id).list, 'camping');
  assert.equal(S.tickItem('shopping', { id: queue[2].body.id }, true).ok, true);
  const pc = S.readLists().lists;
  const shop = pc.find(l => l.id === 'shopping')!;
  assert.deepEqual(shop.items.map(i => [i.text, i.done]), [['Milk', false], ['Bread', false], ['Eggs', true]]);
  assert.ok(pc.some(l => l.id === 'camping'));
});
