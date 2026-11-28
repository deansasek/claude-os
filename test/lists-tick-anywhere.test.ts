// "Tick off milk on the list" with no list named (src/apps/lists/web/voice-match.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchList } from '../src/apps/lists/web/voice-match.ts';

test('a tick with no list named is heard for any list: "tick off", "cross off", "check off" and "tick ... off the list"', () => {
  assert.deepEqual(matchList('tick off milk on the list'), { op: 'tick-any', text: 'Milk' });
  assert.deepEqual(matchList('tick milk off the list'), { op: 'tick-any', text: 'Milk' });
  assert.deepEqual(matchList('cross milk off my list'), { op: 'tick-any', text: 'Milk' });
  assert.deepEqual(matchList('check off milk on the list'), { op: 'tick-any', text: 'Milk' });
});

test('a tick that names its list is still heard as a tick on that list', () => {
  assert.deepEqual(matchList('tick off milk on the shopping list'), { op: 'tick', list: 'shopping', text: 'Milk' });
});

test('a pronoun or no item is not an item to tick', () => {
  assert.equal(matchList('tick off it on the list'), null);
});
