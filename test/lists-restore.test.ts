// Undo of a removed list item puts it back at its old place, with its old id, tick and time (lists-restore).
// The tablet's copy (web/local.ts applyOp) and the PC's rule (api.ts restoreItemAt) are checked here. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restoreItemAt, tickedPlaces, type FamilyList } from '../src/apps/lists/api.ts';
import { applyOp, type Op } from '../src/apps/lists/web/local.ts';

const at = '2026-01-02T03:04:05.000Z';
const shopping = (): FamilyList => ({
  id: 'shopping', name: 'Shopping', kind: 'check',
  items: [
    { id: 'ia', text: 'A', done: false, at },
    { id: 'ib', text: 'B', done: true, at },
    { id: 'ic', text: 'C', done: false, at },
  ],
});
const ids = (l: FamilyList): string[] => l.items.map(i => i.id);

test('an undone remove puts the item back in its old place, with its id, tick and time', () => {
  const l = shopping();
  const removed = l.items.splice(1, 1)[0];
  assert.deepEqual(restoreItemAt(l, removed, 1), { ...removed });
  assert.deepEqual(ids(l), ['ia', 'ib', 'ic']);
  assert.equal(l.items[1].done, true);
  assert.equal(l.items[1].at, at);
});

test('the tablet copy restores the item at the same place (restore-item op)', () => {
  const lists = [shopping()];
  const removed = lists[0].items[1];
  const afterRemove = applyOp(lists, { path: 'remove', body: { list: 'shopping', id: 'ib' } });
  assert.equal(afterRemove.ok, true);
  const op: Op = { path: 'restore-item', body: { list: 'shopping', item: removed, index: 1 } };
  const back = applyOp(afterRemove.lists, op);
  assert.equal(back.ok, true);
  assert.deepEqual(ids(back.lists[0]), ['ia', 'ib', 'ic']);
});

test('an index past the end puts the item at the end; a missing index does too', () => {
  const l = shopping();
  restoreItemAt(l, { id: 'id1', text: 'D' }, 99);
  assert.deepEqual(ids(l), ['ia', 'ib', 'ic', 'id1']);
  restoreItemAt(l, { id: 'ie1', text: 'E' }, undefined);
  assert.equal(l.items[l.items.length - 1].id, 'ie1');
});

test('an item whose id or text is already on the list is refused, and nothing changes', () => {
  const l = shopping();
  assert.match(String(restoreItemAt(l, { id: 'ib', text: 'Z' }, 0)), /isn’t an item|already/);
  assert.match(String(restoreItemAt(l, { id: 'ix', text: 'a' }, 0)), /already on Shopping/);
  assert.deepEqual(ids(l), ['ia', 'ib', 'ic']);
});

test('a bad id or an empty text is refused', () => {
  const l = shopping();
  assert.equal(typeof restoreItemAt(l, { id: 'bad id', text: 'X' }, 0), 'string');
  assert.equal(typeof restoreItemAt(l, { id: 'ix', text: '   ' }, 0), 'string');
  assert.equal(l.items.length, 3);
});

test('Undo after Clear ticked puts each item back in its place, id, tick and time', () => {
  const l = shopping();
  l.items[0].done = true;
  l.items[1].done = false;
  l.items[2].done = true;
  const before = l.items.map(i => ({ ...i }));
  const back = tickedPlaces(l);
  const copy: FamilyList = { ...l, items: l.items.filter(i => !i.done) };
  for (const entry of [...back].sort((a, b) => a.index - b.index)) {
    assert.equal(typeof restoreItemAt(copy, entry.item, entry.index), 'object');
  }
  assert.deepEqual(ids(copy), before.map(i => i.id));
  copy.items.forEach((item, n) => {
    assert.equal(item.done, before[n].done);
    assert.equal(item.at, before[n].at);
  });
});

test('the add op still adds by text at the end (Lists add is unchanged)', () => {
  const r = applyOp([shopping()], { path: 'add', body: { list: 'shopping', text: 'Bread' } });
  assert.equal(r.ok, true);
  assert.equal(r.lists[0].items[3].text, 'Bread');
});
