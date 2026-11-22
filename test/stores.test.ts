// The pure parts of the lists and routines stores (no file is read or written). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanList, findItem, idFor as listId, itemText } from '../src/apps/lists/server/store.ts';
import { cleanStored, idFor as routineId } from '../src/apps/routines/server/store.ts';

const list = (items: { id: string; text: string; done?: boolean }[]) => ({
  id: 'shopping', name: 'Shopping', kind: 'check' as const,
  items: items.map(i => ({ id: i.id, text: i.text, done: !!i.done, at: '2026-11-22T10:00:00.000Z' })),
});

// findItem returns an item, undefined, or 'many': the id of an item, or the value itself
const idOf = (x: unknown) => (x && typeof x === 'object' ? (x as { id: string }).id : x);

test('itemText trims and refuses empty or very long text', () => {
  assert.deepEqual(itemText('  milk  '), { text: 'milk' });
  assert.ok('error' in itemText('   '));
  assert.ok('error' in itemText('x'.repeat(500)));
  assert.ok('error' in itemText(7));
});

test('findItem matches by id, then exact text, then a single partial match', () => {
  const l = list([{ id: 'i1', text: 'Oat milk' }, { id: 'i2', text: 'Milk' }, { id: 'i3', text: 'Bread' }]);
  assert.equal((findItem(l, { id: 'i3' }) as { text: string }).text, 'Bread');
  assert.equal(idOf(findItem(l, { text: 'milk' })), 'i2');        // exact beats partial
  assert.equal(idOf(findItem(l, { text: 'bread' })), 'i3');
  assert.equal(findItem(l, { text: 'cheese' }), undefined);
});

test('findItem prefers the one unticked match, and reports many when it cannot choose', () => {
  const l = list([{ id: 'a', text: 'Apple juice', done: true }, { id: 'b', text: 'Apple crumble' }]);
  assert.equal(idOf(findItem(l, { text: 'apple' })), 'b');
  const two = list([{ id: 'c', text: 'Apple pie' }, { id: 'd', text: 'Apple tart' }]);
  assert.equal(findItem(two, { text: 'apple' }), 'many');
});

test('cleanList keeps good items, drops empty ones, and repairs duplicate ids', () => {
  const out = cleanList({
    id: 'garden', name: '  Garden jobs  ', kind: 'check',
    items: [{ id: 'x', text: 'Weed', done: true }, { id: 'x', text: 'Water' }, { text: '   ' }],
  });
  assert.ok(out);
  assert.equal(out.name, 'Garden jobs');
  assert.equal(out.items.length, 2);
  assert.notEqual(out.items[0].id, out.items[1].id);
  assert.equal(out.items[0].done, true);
});

test('cleanList refuses a bad id and a missing name, and makes unknown kinds a check list', () => {
  assert.equal(cleanList({ id: 'Bad Id!', name: 'X', items: [] }), null);
  assert.equal(cleanList({ id: 'ok', name: '   ', items: [] }), null);
  const notes = cleanList({ id: 'ok', name: 'Notes', kind: 'other', items: [] });
  assert.equal(notes?.kind, 'check');
});

test('list ids come from the name and skip taken ones', () => {
  assert.equal(listId('Garden jobs', []), 'garden-jobs');
  const taken = [{ id: 'garden-jobs', name: 'x', kind: 'check' as const, items: [] }];
  assert.equal(listId('Garden jobs', taken), 'garden-jobs-2');
  assert.match(listId('2 for tea', []), /^l-/);
});

test('routine ids come from the name and skip taken ones', () => {
  assert.equal(routineId('Good morning', []), 'good-morning');
  const taken = [{ id: 'good-morning', name: 'x', phrases: ['x'], steps: [] }];
  assert.equal(routineId('Good morning', taken as never), 'good-morning-2');
});

test('cleanStored rejects a routine with a bad id and keeps a good one', () => {
  assert.equal(cleanStored({ id: '../x', name: 'X', phrases: ['x'], steps: [] }), null);
  assert.equal(cleanStored(null), null);
});
