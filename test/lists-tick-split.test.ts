// Voice "cross milk off the shopping list" ticks the item (src/apps/lists/web/voice-match.ts matchList). "take milk off" stays a remove.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchList } from '../src/apps/lists/web/voice-match.ts';

test('the item can come between the verb and off', () => {
  assert.deepEqual(matchList('cross milk off the shopping list'), { op: 'tick', list: 'shopping', text: 'Milk' });
  assert.deepEqual(matchList('tick eggs off my to-do list'), { op: 'tick', list: 'todo', text: 'Eggs' });
  assert.deepEqual(matchList('check bread off the grocery list'), { op: 'tick', list: 'shopping', text: 'Bread' });
});

test('the verb-first tick form still matches the same way', () => {
  assert.deepEqual(matchList('tick off milk on the shopping list'), { op: 'tick', list: 'shopping', text: 'Milk' });
});

test('take milk off still means remove, not tick', () => {
  assert.deepEqual(matchList('take milk off the shopping list'), { op: 'remove', list: 'shopping', text: 'Milk' });
});
