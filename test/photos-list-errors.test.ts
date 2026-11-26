// listPhotos: a missing photos folder is an empty gallery, but any other read error is thrown, not hidden as empty.
// The folder read is stubbed, so no files are touched. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { listPhotos } from '../src/apps/photos/server/store.ts';

const failWith = (code: string) => {
  const e = new Error(code) as NodeJS.ErrnoException;
  e.code = code;
  return (() => { throw e; }) as unknown as typeof fs.readdirSync;
};

test('a missing photos folder is an empty gallery', () => {
  const real = fs.readdirSync;
  fs.readdirSync = failWith('ENOENT');
  try {
    assert.deepEqual(listPhotos(), []);
  } finally {
    fs.readdirSync = real;
  }
});

test('an unreadable photos folder is an error, not an empty gallery', () => {
  const real = fs.readdirSync;
  fs.readdirSync = failWith('EACCES');
  try {
    assert.throws(() => listPhotos(), { code: 'EACCES' });
  } finally {
    fs.readdirSync = real;
  }
});
