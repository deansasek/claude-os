// The lists store, run against a scratch file (never the family's lists). Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

// The store reads its file path when it loads, so the scratch file is set before the import.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-lists-'));
const file = path.join(dir, 'lists.json');
process.env.CLAUDEOS_LISTS_FILE = file;
const L = await import('../src/apps/lists/server/store.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const shopping = () => L.readLists().lists.find(l => l.id === 'shopping')!;

test('with no file, the three built-in lists are there', () => {
  const r = L.readLists();
  assert.equal(r.ok, true);
  assert.deepEqual(r.lists.map(l => l.id), ['shopping', 'todo', 'notes']);
  assert.equal(fs.existsSync(file), false, 'reading does not create the file');
});

test('adding an item writes it to the file, and leaves no .tmp file behind', () => {
  const r = L.addItem('shopping', 'Milk');
  assert.equal(r.ok, true);
  assert.equal(r.item?.text, 'Milk');
  assert.equal(shopping().items.length, 1);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('adding the same text again does not make a second copy', () => {
  L.addItem('shopping', 'milk');
  assert.equal(shopping().items.length, 1);
});

test('ticking an item by its text, then unticking it by id', () => {
  assert.equal(L.tickItem('shopping', { text: 'milk' }, true).ok, true);
  let item = shopping().items[0];
  assert.equal(item.done, true);
  L.tickItem('shopping', { id: item.id }, false);
  item = shopping().items[0];
  assert.equal(item.done, false);
});

test('clearing the ticked items removes only those', () => {
  L.addItem('shopping', 'Bread');
  L.tickItem('shopping', { text: 'Milk' }, true);
  L.clearDone('shopping');
  assert.deepEqual(shopping().items.map(i => i.text), ['Bread']);
});

test('a file that cannot be read is reported and left as it is', () => {
  fs.writeFileSync(file, '{not json');
  const r = L.readLists();
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{not json');
});
