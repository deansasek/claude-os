// Voice-added items with an Oxford comma (src/apps/lists/web/voice-match.ts matchList). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchList } from '../src/apps/lists/web/voice-match.ts';

test('an Oxford comma before "and" does not make an item called "And bread"', () => {
  assert.deepEqual(matchList('add milk, eggs, and bread to the shopping list'),
    { op: 'addMany', list: 'shopping', texts: ['Milk', 'Eggs', 'Bread'] });
});

test('a comma list on a custom list keeps each item', () => {
  const custom = [{ id: 'camping', name: 'Camping' }];
  assert.deepEqual(matchList('put tent, stove, and gas on the camping list', custom),
    { op: 'addMany', list: 'camping', texts: ['Tent', 'Stove', 'Gas'] });
});

test('a comma before "to" does not leave "Eggs comma"', () => {
  assert.deepEqual(matchList('add milk, eggs, to the shopping list'),
    { op: 'addMany', list: 'shopping', texts: ['Milk', 'Eggs'] });
});

test('a comma list without an Oxford comma is unchanged, and "and" inside an item stays', () => {
  assert.deepEqual(matchList('add milk, eggs and bread to the shopping list'),
    { op: 'addMany', list: 'shopping', texts: ['Milk', 'Eggs', 'Bread'] });
  assert.deepEqual(matchList('add mac and cheese to the shopping list'),
    { op: 'add', list: 'shopping', text: 'Mac and cheese' });
});
