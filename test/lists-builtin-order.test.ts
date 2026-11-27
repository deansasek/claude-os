// The built-in lists come first, in their order, even when the lists file lost one (src/apps/lists/server/store.ts load). Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-lists-order-'));
const file = path.join(dir, 'lists.json');
process.env.CLAUDEOS_LISTS_FILE = file;
const L = await import('../src/apps/lists/server/store.ts');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const list = (id: string, name: string) => ({ id, name, kind: 'check', items: [] });

test('a file that lost Notes loads the built-ins in their order, then the custom list', () => {
  fs.writeFileSync(file, JSON.stringify({ lists: [list('shopping', 'Shopping'), list('todo', 'To-do'), list('camping', 'Camping')] }));
  const ids = L.readLists().lists.map(l => l.id);
  assert.deepEqual(ids.slice(0, 3), ['shopping', 'todo', 'notes']);
  assert.equal(ids[3], 'camping');
});

test('a file that lost To-do loads To-do after Shopping, not in front of it', () => {
  fs.writeFileSync(file, JSON.stringify({ lists: [list('shopping', 'Shopping'), list('notes', 'Notes')] }));
  const ids = L.readLists().lists.map(l => l.id);
  assert.deepEqual(ids.slice(0, 3), ['shopping', 'todo', 'notes']);
});
