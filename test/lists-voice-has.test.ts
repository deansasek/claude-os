// Voice "is milk on the shopping list?" reads the list and never changes it (src/apps/lists/web/voice-match.ts matchList).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchList } from '../src/apps/lists/web/voice-match.ts';

test('is, are and do we have on a list are read into a has command', () => {
  assert.deepEqual(matchList('is milk on the shopping list'), { op: 'has', list: 'shopping', text: 'Milk' });
  assert.deepEqual(matchList('are eggs on my to-do list'), { op: 'has', list: 'todo', text: 'Eggs' });
  assert.deepEqual(matchList('do we have bread on the grocery list'), { op: 'has', list: 'shopping', text: 'Bread' });
});

test('a has with no item, or an it, is not a command', () => {
  assert.equal(matchList('is it on the shopping list'), null);
  assert.equal(matchList('is on the shopping list'), null);
});
