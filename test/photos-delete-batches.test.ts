// Photos delete (src/apps/photos/api.ts deleteBatches): more than 200 selected photos go in batches the PC accepts.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DELETE_BATCH, deleteBatches } from '../src/apps/photos/api.ts';
import { MAX_PER_DELETE } from '../src/apps/photos/server/store.ts';

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${String(i).padStart(4, '0')}`);

test('the batch size is the most ids the PC takes in one delete', () => {
  assert.equal(DELETE_BATCH, MAX_PER_DELETE);
});

test('201 selected photos make two requests, 200 then 1, in order', () => {
  const all = ids(201);
  const batches = deleteBatches(all);
  assert.deepEqual(batches.map(b => b.length), [200, 1]);
  assert.deepEqual(batches.flat(), all);
});

test('exactly 200 or fewer is one request; none is none', () => {
  assert.equal(deleteBatches(ids(200)).length, 1);
  assert.equal(deleteBatches(ids(3)).length, 1);
  assert.deepEqual(deleteBatches([]), []);
});

test('450 selected photos make batches of 200, 200 and 50, with every id once', () => {
  const all = ids(450);
  const batches = deleteBatches(all);
  assert.deepEqual(batches.map(b => b.length), [200, 200, 50]);
  assert.equal(new Set(batches.flat()).size, 450);
  assert.ok(batches.every(b => b.length <= MAX_PER_DELETE));
});
