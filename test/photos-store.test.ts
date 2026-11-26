// Photo ids and paths: a thumbnail's name is never a photo id, and paths stay inside the photos folder. Pure checks only,
// so no photo files are read or written. Run with: npm test
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { test } from 'node:test';
import { insidePhotos, listPhotosPage, PHOTOS, photoIdsFrom, safeId } from '../src/apps/photos/server/store.ts';

/** Run fn with one day folder holding these photo files. The folder reads are stubbed, so no photo files are touched. */
function withDayFolder(names: string[], fn: () => void): void {
  const realRead = fs.readdirSync, realStat = fs.statSync;
  const day = '2026-11-26';
  fs.readdirSync = ((p: fs.PathLike) => (String(p) === PHOTOS ? [day] : names)) as unknown as typeof fs.readdirSync;
  fs.statSync = (() => ({ mtimeMs: 1000 })) as unknown as typeof fs.statSync;
  try { fn(); } finally { fs.readdirSync = realRead; fs.statSync = realStat; }
}
const PHOTO_FILES = ['abcdefgh01.jpg', 'abcdefgh02.jpg', 'abcdefgh03.jpg'];

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

test('a list cut at its limit reports more photos left out', () => {
  withDayFolder(PHOTO_FILES, () => {
    const page = listPhotosPage(2);
    assert.equal(page.more, true);
    assert.equal(page.days[0].photos.length, 2);
  });
});

test('a list that holds every photo does not report more', () => {
  withDayFolder(PHOTO_FILES.slice(0, 2), () => {
    assert.equal(listPhotosPage(2).more, false);
    assert.equal(listPhotosPage(5).more, false);
  });
});
