// Photo ids and paths: a thumbnail's name is never a photo id, and paths stay inside the photos folder. Pure checks only,
// so no photo files are read or written. Run with: npm test
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { test } from 'node:test';
import { deletePhotos, insidePhotos, listPhotosPage, PHOTOS, photoIdsFrom, safeId } from '../src/apps/photos/server/store.ts';

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

test('a photo whose folder cannot be read is failed, not reported as already gone', () => {
  const realRead = fs.readdirSync;
  fs.readdirSync = ((p: fs.PathLike) => {
    if (String(p) === PHOTOS) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return realRead(p);
  }) as unknown as typeof fs.readdirSync;
  try {
    const r = deletePhotos(['abc123def456']);
    assert.deepEqual(r.failed, ['abc123def456']);
    assert.deepEqual(r.missing, []);
  } finally {
    fs.readdirSync = realRead;
  }
});

test('a photos folder that is not there (ENOENT) still reports the photo as missing', () => {
  const realRead = fs.readdirSync;
  fs.readdirSync = ((p: fs.PathLike) => {
    if (String(p) === PHOTOS) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
    return realRead(p);
  }) as unknown as typeof fs.readdirSync;
  try {
    const r = deletePhotos(['abc123def456']);
    assert.deepEqual(r.missing, ['abc123def456']);
    assert.deepEqual(r.failed, []);
  } finally {
    fs.readdirSync = realRead;
  }
});

test('a photo the PC cannot write is reported as write_failed, with no path in the answer and no partial file left', async () => {
  const { savePhoto } = await import('../src/apps/photos/server/store.ts');
  const realWrite = fs.writeFileSync, realMkdir = fs.mkdirSync;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  fs.writeFileSync = ((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    if (String(p).endsWith('.part')) throw Object.assign(new Error('ENOSPC: no space'), { code: 'ENOSPC' });
    return (realWrite as (...a: unknown[]) => void)(p, ...rest);
  }) as typeof fs.writeFileSync;
  fs.mkdirSync = (() => undefined) as unknown as typeof fs.mkdirSync;   // no folder is made in the real photos folder
  try {
    const r = savePhoto('a1b2c3d4e5f6', jpeg);
    assert.deepEqual(r, { ok: false, error: 'write_failed' });
    assert.equal(JSON.stringify(r).includes(PHOTOS), false, 'no folder path reaches the answer');
  } finally {
    fs.writeFileSync = realWrite;
    fs.mkdirSync = realMkdir;
  }
});

test('a thumbnail the PC cannot rename is reported as write_failed, with no part file and no path in the answer', async () => {
  const { saveThumb } = await import('../src/apps/photos/server/store.ts');
  const realRead = fs.readdirSync;
  const day = '2026-11-26';
  const id = 'a1b2c3d4e5f6';
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  fs.readdirSync = ((p: fs.PathLike, o?: unknown) => (String(p) === PHOTOS ? [day] : realRead(p, o as never))) as unknown as typeof fs.readdirSync;
  const realWrite = fs.writeFileSync, realRename = fs.renameSync, realExists = fs.existsSync;
  // the photo itself counts as there (locate looks for it)
  fs.existsSync = ((p: fs.PathLike) => String(p).endsWith(`${id}.jpg`) || realExists(p)) as typeof fs.existsSync;
  // no real folder is made or touched: the writes and the rename are stubbed
  const writes: string[] = [];
  fs.writeFileSync = ((p: fs.PathOrFileDescriptor) => { writes.push(String(p)); })as unknown as typeof fs.writeFileSync;
  fs.renameSync = (() => { throw Object.assign(new Error('EPERM: locked'), { code: 'EPERM' }); }) as unknown as typeof fs.renameSync;
  try {
    const r = saveThumb(id, jpeg);
    assert.deepEqual(r, { ok: false, error: 'write_failed' });
    assert.equal(JSON.stringify(r).includes(PHOTOS), false, 'no folder path reaches the answer');
    assert.equal(writes.length, 1, 'the part file was written once');
    assert.ok(writes[0].endsWith('_thumb.jpg.part'));
  } finally {
    fs.readdirSync = realRead;
    fs.writeFileSync = realWrite;
    fs.renameSync = realRename;
    fs.existsSync = realExists;
  }
});
