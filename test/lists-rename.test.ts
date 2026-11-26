// A family list can be renamed: its id stays, the built-in lists are refused, and a name in use is refused. Scratch files only. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-lists-rename-'));
process.env.CLAUDEOS_LISTS_FILE = path.join(dir, 'lists.json');
process.env.CLAUDEOS_LISTS_HISTORY = path.join(dir, 'history.json');
const L = await import('../src/apps/lists/server/store.ts');
const { applyOp } = await import('../src/apps/lists/web/local.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => fs.rmSync(L.FILE, { force: true }));

test('a family list is renamed, and keeps its id', () => {
  const made = L.newList('Hardwear');
  assert.equal(made.ok, true);
  const id = (made as { list: string }).list;
  const r = L.renameList(id, 'Hardware');
  assert.equal(r.ok, true);
  assert.equal(L.readLists().lists.find(l => l.id === id)?.name, 'Hardware');
});

test('the built-in lists cannot be renamed, and a name already in use is refused', () => {
  assert.equal(L.renameList('shopping', 'Groceries').ok, false, 'Shopping stays Shopping');
  L.newList('Hardware');
  L.newList('Garden');
  const garden = L.readLists().lists.find(l => l.name === 'Garden')!.id;
  const r = L.renameList(garden, 'hardware');
  assert.equal(r.ok, false, 'a name in use (ignoring case) is refused');
  assert.equal(L.readLists().lists.find(l => l.id === garden)?.name, 'Garden', 'the list keeps its name');
});

test('the tablet copy of a rename applies the same rules and keeps the id', () => {
  const lists = [{ id: 'hw', name: 'Hardwear', kind: 'check' as const, items: [] }, { id: 'gd', name: 'Garden', kind: 'check' as const, items: [] }];
  const ok = applyOp(lists, { path: 'rename-list', body: { list: 'hw', name: 'Hardware' } });
  assert.equal(ok.ok, true);
  assert.equal(ok.lists?.find(l => l.id === 'hw')?.name, 'Hardware');
  const same = applyOp(lists, { path: 'rename-list', body: { list: 'gd', name: 'HARDWEAR' } });
  assert.equal(same.ok, false, 'a name in use is refused on the tablet too');
});
