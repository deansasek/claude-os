// What the family buys: counted when ticked items are cleared, and offered once bought twice and not on the list.
// Scratch files only (never the family's lists or history). Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-hist-'));
process.env.CLAUDEOS_LISTS_FILE = path.join(dir, 'lists.json');
process.env.CLAUDEOS_LISTS_HISTORY = path.join(dir, 'history.json');
const L = await import('../src/apps/lists/server/store.ts');
const H = await import('../src/apps/lists/server/history.ts');
const { keptSuggest } = await import('../src/apps/lists/web/suggest.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Buy one thing: add it, tick it off, clear the ticked items. */
function buy(text: string): void {
  L.addItem('shopping', text);
  const item = L.readLists().lists.find(l => l.id === 'shopping')!.items.find(i => i.text === text)!;
  L.tickItem('shopping', { id: item.id }, true);
  L.clearDone('shopping');
}

test('a thing bought once is not suggested yet', () => {
  buy('Milk');
  assert.deepEqual(H.suggestions([]), []);
});

test('a thing bought twice is suggested, as it was written', () => {
  buy('Milk');
  assert.deepEqual(H.suggestions([]), ['Milk']);
});

test('a suggestion is not shown when the item is already on the list', () => {
  assert.deepEqual(H.suggestions(['milk']), []);
});

test('removing an item is not counted as buying it', () => {
  L.addItem('shopping', 'Bread');
  const item = L.readLists().lists.find(l => l.id === 'shopping')!.items.find(i => i.text === 'Bread')!;
  L.removeItem('shopping', item.id);
  assert.equal(H.suggestions([]).includes('Bread'), false);
});

test('the history file is kept for the next start', () => {
  assert.equal(fs.existsSync(process.env.CLAUDEOS_LISTS_HISTORY!), true);
  const saved = JSON.parse(fs.readFileSync(process.env.CLAUDEOS_LISTS_HISTORY!, 'utf8'));
  assert.equal(saved.counts.milk.n, 2);
});

test('a good suggest read replaces the chips', () => {
  assert.deepEqual(keptSuggest(['Eggs'], ['Milk', 'Bread'], []), ['Milk', 'Bread']);
});

test('a failed suggest read keeps the chips on screen', () => {
  assert.deepEqual(keptSuggest(['Eggs', 'Milk'], null, []), ['Eggs', 'Milk']);
});

test('a failed suggest read drops a chip that is now open on Shopping, ignoring case', () => {
  assert.deepEqual(keptSuggest(['Eggs', 'Milk'], null, ['milk']), ['Eggs']);
});
