// The reader rule for the lists (src/apps/lists/web/read.ts): the tablet's copy when there is one, else the PC. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FamilyList, ListsResult } from '../src/apps/lists/api.ts';
import { pickLists } from '../src/apps/lists/web/read.ts';

const copy: FamilyList[] = [{ id: 'shopping', name: 'Shopping', kind: 'check', items: [{ id: 'i1', text: 'Milk', done: false, at: '' }] }];
const pc: ListsResult = { ok: true, lists: [{ id: 'shopping', name: 'Shopping', kind: 'check', items: [] }] };

test('the tablet copy is used when present, and the PC is not asked', async () => {
  let asked = 0;
  const got = await pickLists(copy, async () => { asked++; return pc; });
  assert.equal(got, copy);
  assert.equal(asked, 0);
});

test('the PC is used when there is no copy (first run, Nest Hub)', async () => {
  assert.deepEqual(await pickLists(null, async () => pc), pc.lists);
});

test('a PC answer with ok: true and no lists array reads as none', async () => {
  assert.deepEqual(await pickLists(null, async () => ({ ok: true, lists: undefined as unknown as FamilyList[] })), []);
});

test('a PC answer with ok: false rejects with the PC error, not empty lists', async () => {
  const unreadable = 'The lists file on the PC couldn’t be read, so nothing was changed.';
  await assert.rejects(pickLists(null, async () => ({ ok: false, lists: [], error: unreadable, retry: true })), (e: Error) => e.message === unreadable);
});

test('a PC that cannot be reached still throws, so the caller can say so', async () => {
  await assert.rejects(pickLists(null, async () => { throw new Error('offline'); }), /offline/);
});
