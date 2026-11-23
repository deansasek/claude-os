// Editing an item's text: the store's checks (POST /api/lists/edit) and voice "change milk to oat milk". Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import type { FamilyList } from '../src/apps/lists/api.ts';
import { findExact, matchList } from '../src/apps/lists/web/voice-match.ts';

// The store reads its file path when it loads, so the scratch file is set before the import.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-edit-'));
process.env.CLAUDEOS_LISTS_FILE = path.join(dir, 'lists.json');
const L = await import('../src/apps/lists/server/store.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const shopping = (): FamilyList => ({
  id: 'shopping', name: 'Shopping', kind: 'check', items: [
    { id: 'i1', text: 'Milk', done: true, at: '2026-01-01T00:00:00.000Z' },
    { id: 'i2', text: 'Bread', done: false, at: '2026-01-01T00:00:00.000Z' },
  ],
});

test('renameItem changes the text and keeps the id, the tick and the place', () => {
  const l = shopping();
  const r = L.renameItem(l, 'i1', '  Oat   milk ');
  assert.equal(typeof r, 'object');
  assert.deepEqual(l.items[0], { id: 'i1', text: 'Oat milk', done: true, at: '2026-01-01T00:00:00.000Z' });
  assert.equal(l.items[1].text, 'Bread');
});

test('renameItem refuses a bad id, an unknown id, empty text and text that is too long', () => {
  const l = shopping();
  assert.equal(L.renameItem(l, 42, 'Oat milk'), 'That isn’t an item.');
  assert.equal(L.renameItem(l, '../x', 'Oat milk'), 'That isn’t an item.');
  assert.equal(L.renameItem(l, 'i9', 'Oat milk'), 'That isn’t on Shopping.');
  assert.equal(L.renameItem(l, 'i1', '   '), 'Type the new text.');
  assert.equal(L.renameItem(l, 'i1', null), 'Type the new text.');
  assert.match(L.renameItem(l, 'i1', 'x'.repeat(81)) as string, /too long/);
  assert.equal(typeof L.renameItem(l, 'i1', 'x'.repeat(80)), 'object');
});

test('renameItem refuses the text of another item, but a change of case on the same item is fine', () => {
  const l = shopping();
  assert.equal(L.renameItem(l, 'i1', 'bread'), 'bread is already on Shopping.');
  assert.equal(l.items[0].text, 'Milk');
  assert.equal(typeof L.renameItem(l, 'i1', 'MILK'), 'object');
  assert.equal(l.items[0].text, 'MILK');
});

test('editItem saves the change to the lists file', () => {
  const added = L.addItem('shopping', 'Milk');
  assert.ok(added.ok && added.item);
  const r = L.editItem('Shopping', added.item.id, 'Oat milk');
  assert.equal(r.ok, true);
  assert.equal(r.item?.text, 'Oat milk');
  const again = L.readLists().lists.find(x => x.id === 'shopping');
  assert.deepEqual(again?.items.map(i => i.text), ['Oat milk']);
  assert.equal(L.editItem('nope', added.item.id, 'Soy milk').error, 'There’s no list by that name.');
  assert.equal(L.editItem('shopping', added.item.id, '').ok, false);
});

test('change and rename are read into an edit command, with or without a list', () => {
  assert.deepEqual(matchList('change milk to oat milk'), { op: 'edit', list: null, text: 'Milk', to: 'Oat milk' });
  assert.deepEqual(matchList('rename milk to oat milk'), { op: 'edit', list: null, text: 'Milk', to: 'Oat milk' });
  assert.deepEqual(matchList('change the milk to oat milk on the shopping list'), { op: 'edit', list: 'shopping', text: 'Milk', to: 'Oat milk' });
  assert.deepEqual(matchList('rename tent to big tent on the camping list', [{ id: 'camping', name: 'Camping' }]),
    { op: 'edit', list: 'camping', text: 'Tent', to: 'Big tent' });
});

test('an edit of a list, or of it, is not a command', () => {
  assert.equal(matchList('rename the shopping list to groceries'), null);
  assert.equal(matchList('change it to oat milk'), null);
  assert.equal(matchList('change milk to oat milk on the camping list'), null);   // no such list: Claude gets it
});

test('findExact finds only exact words, on every list', () => {
  const lists = [shopping(), { id: 'todo', name: 'To-do', kind: 'check' as const, items: [{ id: 'i3', text: 'milk', done: false, at: '' }] }];
  assert.deepEqual(findExact(lists, 'bread').map(h => h.item.id), ['i2']);
  assert.deepEqual(findExact(lists, 'MILK').map(h => `${h.list.id}/${h.item.id}`), ['shopping/i1', 'todo/i3']);
  assert.deepEqual(findExact(lists, 'brea'), []);   // a partial match is not enough with no list said
});
