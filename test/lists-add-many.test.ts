// Voice "add milk, eggs and bread to the shopping list": several items only when the words have commas. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addManyReply, matchList } from '../src/apps/lists/web/voice-match.ts';

test('comma-separated items are each added', () => {
  assert.deepEqual(matchList('add milk, eggs and bread to the shopping list'),
    { op: 'addMany', list: 'shopping', texts: ['Milk', 'Eggs', 'Bread'] });
  assert.deepEqual(matchList('put a lemon, some rice on my to-do list'),
    { op: 'addMany', list: 'todo', texts: ['Lemon', 'Rice'] });
});

test('without a comma, "and" stays inside one item', () => {
  assert.deepEqual(matchList('add milk and eggs to the shopping list'), { op: 'add', list: 'shopping', text: 'Milk and eggs' });
  assert.deepEqual(matchList('add mac and cheese to the shopping list'), { op: 'add', list: 'shopping', text: 'Mac and cheese' });
});

test('a single item with a comma-free phrase is still one add', () => {
  assert.deepEqual(matchList('add milk to the shopping list'), { op: 'add', list: 'shopping', text: 'Milk' });
});

test('more than ten items at once is not a command; an empty item between commas is dropped', () => {
  const many = 'add a, b, c, d, e, f, g, h, i, j, k to the shopping list';
  assert.equal(matchList(many), null);
  assert.deepEqual(matchList('add milk, , eggs to the shopping list'),
    { op: 'addMany', list: 'shopping', texts: ['Milk', 'Eggs'] });
});

test('the reply says how many went, and which are waiting for the PC', () => {
  assert.equal(addManyReply(['Milk', 'Eggs', 'Bread'], 3, 0, 'the shopping list'), 'Added milk, eggs and bread to the shopping list.');
  assert.equal(addManyReply(['Milk', 'Eggs', 'Bread'], 1, 2, 'the shopping list'), 'Added 1 of 3 to the shopping list. The other 2 will be added when the PC is back.');
  assert.equal(addManyReply(['Milk', 'Eggs'], 0, 2, 'the shopping list'), 'I can’t reach the shopping list right now. The 2 items will be added when the PC is back.');
  assert.equal(addManyReply(['Milk'], 0, 1, 'the shopping list'), 'I can’t reach the shopping list right now. It will be added when the PC is back.');
});
