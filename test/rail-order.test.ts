// The rail's saved pins keep a pin that a focus mode hides, in its place, when the shown pins are dragged. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reorderPins } from '../src/core/web/rail-order.ts';

test('a hidden pin keeps its place after a reorder of the shown pins', () => {
  // old: a, photos (hidden), b, c. The user drags c to the front: photos stays after a.
  assert.deepEqual(reorderPins(['a', 'photos', 'b', 'c'], ['c', 'a', 'b']), ['c', 'a', 'photos', 'b']);
});

test('the order is unchanged when nothing is hidden', () => {
  assert.deepEqual(reorderPins(['a', 'b', 'c'], ['b', 'a', 'c']), ['b', 'a', 'c']);
});

test('a hidden pin at the start of the list stays first', () => {
  assert.deepEqual(reorderPins(['photos', 'a', 'b'], ['b', 'a']), ['photos', 'b', 'a']);
});
