// Voice "clear the ticked items off the shopping list" (the same as the Clear ticked button). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchList } from '../src/apps/lists/web/voice-match.ts';

test('clearing the ticked items is read for Shopping and To-do', () => {
  assert.deepEqual(matchList('clear the ticked items off the shopping list'), { op: 'clear', list: 'shopping' });
  assert.deepEqual(matchList('clear my done items from my to-do list'), { op: 'clear', list: 'todo' });
  assert.deepEqual(matchList('empty the checked items off the grocery list'), { op: 'clear', list: 'shopping' });
});

test('clearing with no list named is not a command, and a plain clear is not either', () => {
  assert.equal(matchList('clear the ticked items'), null);
  assert.equal(matchList('clear the shopping list'), null);
});

test('a family list is cleared by its name too', () => {
  assert.deepEqual(matchList('clear the ticked items off the camping list', [{ id: 'camping', name: 'Camping' }]),
    { op: 'clear', list: 'camping' });
});
