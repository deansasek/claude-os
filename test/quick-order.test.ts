// The control center tile order (src/core/web/quick-order.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepAwakeWanted, moveTile, orderTiles, TILE_IDS } from '../src/core/web/quick-order.ts';

test('orderTiles with nothing saved is the default order', () => {
  assert.deepEqual(orderTiles(null), [...TILE_IDS]);
  assert.deepEqual(orderTiles('not json'), [...TILE_IDS]);
  assert.deepEqual(orderTiles('{"a":1}'), [...TILE_IDS]);
});

test('orderTiles keeps the saved order, drops unknown and repeated ids, and adds new tiles at the end', () => {
  const order = orderTiles(JSON.stringify(['clock', 'bogus', 'wifi', 'clock', 42]));
  assert.deepEqual(order.slice(0, 2), ['clock', 'wifi']);
  assert.equal(order.length, TILE_IDS.length);
  assert.equal(new Set(order).size, TILE_IDS.length);
  assert.ok(!order.includes('bogus'));
});

test('moveTile swaps a tile with its neighbour and leaves the ends alone', () => {
  assert.deepEqual(moveTile(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(moveTile(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b']);
  assert.deepEqual(moveTile(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
  assert.deepEqual(moveTile(['a', 'b', 'c'], 'z', 1), ['a', 'b', 'c']);
});

test('Keep awake is on only for the saved text 1, so a saved Off clears it after a restart', () => {
  assert.equal(keepAwakeWanted('1'), true);
  assert.equal(keepAwakeWanted('0'), false);
  assert.equal(keepAwakeWanted(null), false);
  assert.equal(keepAwakeWanted(undefined), false);
  assert.equal(keepAwakeWanted('yes'), false);
});
