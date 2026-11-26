// The words on Home's Shopping row (src/apps/home/web/lists-row.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listsRow } from '../src/apps/home/web/lists-row.ts';

test('before the first read the row says Loading', () => {
  assert.deepEqual(listsRow(null, false), { val: 'Loading…', sub: '' });
});

test('a failed first read says the lists cannot be reached', () => {
  assert.deepEqual(listsRow(null, true), { val: 'Can’t reach the lists', sub: '' });
});

test('a stale read with items shows the Offline prefix before the items', () => {
  const lists = { items: [{ done: false, text: 'Milk' }, { done: false, text: 'Eggs' }, { done: false, text: 'Tea' }] };
  assert.deepEqual(listsRow(lists, true), { val: '3 to get', sub: 'Offline · Milk, Eggs…' });
});

test('a stale read with nothing to get says Offline only', () => {
  const lists = { items: [{ done: true, text: 'Milk' }] };
  assert.deepEqual(listsRow(lists, true), { val: 'Nothing to get', sub: 'Offline' });
});

test('a fresh read has no Offline prefix', () => {
  const lists = { items: [{ done: false, text: 'Milk' }, { done: true, text: 'Eggs' }, { done: false, text: 'Tea' }] };
  assert.deepEqual(listsRow(lists, false), { val: '2 to get', sub: 'Milk, Tea' });
  assert.deepEqual(listsRow({ items: [] }, false), { val: 'Nothing to get', sub: '' });
});
