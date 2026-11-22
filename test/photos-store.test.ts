// Photo ids and paths: a thumbnail's name is never a photo id, and paths stay inside the photos folder. Pure checks only,
// so no photo files are read or written. Run with: npm test
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { insidePhotos, PHOTOS, photoIdsFrom, safeId } from '../src/apps/photos/server/store.ts';

test('a photo id is 8 to 64 safe characters', () => {
  assert.equal(safeId('abcdefgh12'), 'abcdefgh12');
  assert.equal(safeId('short'), null);
  assert.equal(safeId('has space here'), null);
  assert.equal(safeId('../../etc/passwd'), null);
  assert.equal(safeId(42), null);
});

test('an id ending in _thumb is refused: it names a thumbnail file, not a photo', () => {
  assert.equal(safeId('abc12345_thumb'), null);
  assert.equal(safeId('abcdefgh12_thumb'), null);
  assert.equal(photoIdsFrom(['abcdefgh12', 'abc12345_thumb']), null);
});

test('a list of ids is all or nothing', () => {
  assert.deepEqual(photoIdsFrom(['abcdefgh12', 'ijklmnop34']), ['abcdefgh12', 'ijklmnop34']);
  assert.deepEqual(photoIdsFrom(undefined), []);
  assert.equal(photoIdsFrom('abcdefgh12'), null);
});

test('a path counts only inside the photos folder', () => {
  assert.equal(insidePhotos(path.join(PHOTOS, '2026-11-01', 'abcdefgh12.jpg')), true);
  assert.equal(insidePhotos(path.join(PHOTOS, '..', 'config.json')), false);
  assert.equal(insidePhotos(PHOTOS), false);
});
