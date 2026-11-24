// The tablet's copy after a voice change (src/apps/lists/web/read.ts afterWrite): a change the PC took updates the copy,
// a refused change does not, and a change the PC did not get waits in the queue. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FamilyList, ListsResult } from '../src/apps/lists/api.ts';
import { afterWrite } from '../src/apps/lists/web/read.ts';

const copy = (): FamilyList[] => [{ id: 'shopping', name: 'Shopping', kind: 'check', items: [
  { id: 'i1', text: 'Milk', done: false, at: '' },
] }];
const ok = (lists: FamilyList[]): ListsResult => ({ ok: true, lists });

test('a change the PC took updates the copy at once, and is not queued', () => {
  const before = copy();
  const pcLists = copy(); pcLists[0].items[0].done = true;
  const next = afterWrite(before, { path: 'tick', body: { list: 'shopping', id: 'i1', done: true } }, ok(pcLists));
  assert.equal(next.queue, false);
  assert.equal(next.lists[0].items[0].done, true);
  assert.equal(before[0].items[0].done, false);   // the input copy is not changed
});

test('an added item takes the PC id, so the copy and the PC agree', () => {
  const pcLists = copy(); pcLists[0].items.push({ id: 'i9', text: 'Eggs', done: false, at: '' });
  const next = afterWrite(copy(), { path: 'add', body: { list: 'shopping', text: 'Eggs' } }, { ok: true, lists: pcLists, item: pcLists[0].items[1] });
  assert.deepEqual(next.lists[0].items.map(i => i.id), ['i1', 'i9']);
  assert.equal(next.queue, false);
});

test('a refused change leaves the copy as it was and is not queued', () => {
  const before = copy();
  const next = afterWrite(before, { path: 'remove', body: { list: 'shopping', id: 'i1' } }, { ok: false, lists: [], error: 'That isn’t on Shopping.' });
  assert.deepEqual(next.lists, copy());
  assert.equal(next.queue, false);
});

test('a change the PC could not save, or could not be reached, leaves the copy and is queued', () => {
  const retry = afterWrite(copy(), { path: 'tick', body: { list: 'shopping', id: 'i1', done: true } }, { ok: false, lists: [], retry: true, error: 'save failed' });
  assert.deepEqual(retry.lists, copy());
  assert.equal(retry.queue, true);
  const offline = afterWrite(copy(), { path: 'tick', body: { list: 'shopping', id: 'i1', done: true } }, null);
  assert.deepEqual(offline.lists, copy());
  assert.equal(offline.queue, true);
});

test('when the copy lacks the item the PC took, the PC lists are taken', () => {
  const pcLists = [{ id: 'shopping', name: 'Shopping', kind: 'check', items: [] as FamilyList['items'] }] as FamilyList[];
  const next = afterWrite(copy(), { path: 'tick', body: { list: 'shopping', id: 'i7', done: true } }, ok(pcLists));
  assert.deepEqual(next.lists, pcLists);
  assert.equal(next.queue, false);
});
