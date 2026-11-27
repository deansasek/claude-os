// The Photos viewer moves to a neighbour when the photo on screen is deleted (afterDelete in src/apps/photos/api.ts).
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { afterDelete } from '../src/apps/photos/api.ts';

test('a photo in the middle moves on to the next one', () => {
  assert.equal(afterDelete(['a', 'b', 'c'], 'b', new Set(['b'])), 'c');
});

test('the last photo moves back to the one before it', () => {
  assert.equal(afterDelete(['a', 'b', 'c'], 'c', new Set(['c'])), 'b');
});

test('the only photo leaves nothing to move to', () => {
  assert.equal(afterDelete(['a'], 'a', new Set(['a'])), null);
});

test('several deleted at once skip the ones that are gone', () => {
  assert.equal(afterDelete(['a', 'b', 'c', 'd'], 'b', new Set(['b', 'c'])), 'd');
});

test('a photo that is not in the order gives nothing', () => {
  assert.equal(afterDelete(['a', 'b'], 'z', new Set(['z'])), null);
  assert.equal(afterDelete(['a', 'b', 'c'], 'a', new Set()), 'b');
});
