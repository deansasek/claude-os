// Tapping a day's heading in Photos select mode picks that day's photos, or clears them. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toggleDay } from '../src/apps/photos/api.ts';

test('a partly picked day picks all of its photos and keeps the other picks', () => {
  const out = toggleDay(new Set(['a', 'x']), ['a', 'b']);
  assert.deepEqual([...out].sort(), ['a', 'b', 'x']);
});

test('a fully picked day clears only its own photos', () => {
  const out = toggleDay(new Set(['a', 'b', 'x']), ['a', 'b']);
  assert.deepEqual([...out], ['x']);
});

test('an empty day changes nothing', () => {
  const before = new Set(['x']);
  assert.deepEqual([...toggleDay(before, [])], ['x']);
});

test('toggleDay does not change the set it is given', () => {
  const before = new Set(['x']);
  toggleDay(before, ['a']);
  assert.deepEqual([...before], ['x']);
});
