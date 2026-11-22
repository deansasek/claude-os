// Voice "remove milk from the shopping list" and the one-item picker it shares with "tick off". Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchList, pickItem } from '../src/apps/lists/web/voice-match.ts';

test('remove and take off are read into a remove command', () => {
  assert.deepEqual(matchList('remove milk from the shopping list'), { op: 'remove', list: 'shopping', text: 'Milk' });
  assert.deepEqual(matchList('take bread off my to-do list'), { op: 'remove', list: 'todo', text: 'Bread' });
  assert.deepEqual(matchList('delete the eggs from the grocery list'), { op: 'remove', list: 'shopping', text: 'Eggs' });
});

test('a remove with no item, or an it, is not a command', () => {
  assert.equal(matchList('remove it from the shopping list'), null);
  assert.equal(matchList('remove from the shopping list'), null);
});

test('add and tick still match the same way', () => {
  assert.deepEqual(matchList('add milk to the shopping list'), { op: 'add', list: 'shopping', text: 'Milk' });
  assert.deepEqual(matchList('tick off milk on the shopping list'), { op: 'tick', list: 'shopping', text: 'Milk' });
});

test('pickItem takes the exact text, or the only partial match, and never a guess', () => {
  const items = [
    { text: 'Milk', done: false },
    { text: 'Oat milk', done: false },
    { text: 'Bread', done: true },
  ];
  assert.equal(pickItem(items, 'milk', false).hit?.text, 'Milk');            // exact wins over the partial
  assert.equal(pickItem(items, 'bread', false).hit?.text, 'Bread');          // a ticked item is found when not open-only
  assert.equal(pickItem(items, 'bread', true).hit, undefined);               // open only: the ticked one is not
  assert.equal(pickItem(items, 'oat', false).hit?.text, 'Oat milk');         // the only partial match
  const two = pickItem([{ text: 'Oat milk', done: false }, { text: 'Almond milk', done: false }], 'milk', false);
  assert.equal(two.hit, undefined);
  assert.equal(two.ambiguous, true);                                          // more than one: say which one
});
