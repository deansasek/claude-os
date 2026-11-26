// A saved-over JSON file: missing gives null, good gives the value, broken is moved aside. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';
import { readJsonOrSetAside } from '../src/core/server/paths.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-aside-'));
const file = path.join(dir, 'layout.json');

test('a missing file gives null and is not created', () => {
  assert.equal(readJsonOrSetAside(file), null);
  assert.equal(fs.existsSync(file), false);
});

test('a good file gives its value and stays where it is', () => {
  fs.writeFileSync(file, JSON.stringify({ order: ['c:notes'] }));
  assert.deepEqual(readJsonOrSetAside<{ order: string[] }>(file), { order: ['c:notes'] });
  assert.equal(fs.existsSync(file), true);
});

test('a broken file gives null, is moved aside intact, and nothing is written over it', () => {
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, '{ broken');
  assert.equal(readJsonOrSetAside(file), null);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readFileSync(`${file}.corrupt`, 'utf8'), '{ broken');
});

test('a second broken file is kept as .2.corrupt and the first .corrupt copy is unchanged', () => {
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, '{ second broken');
  assert.equal(readJsonOrSetAside(file), null);
  assert.equal(fs.readFileSync(`${file}.corrupt`, 'utf8'), '{ broken', 'the first copy is not replaced');
  assert.equal(fs.readFileSync(`${file}.2.corrupt`, 'utf8'), '{ second broken');
});

test('a broken file that cannot be renamed is still copied to .corrupt, so its bytes are kept', () => {
  const locked = path.join(dir, 'locked.json');
  fs.writeFileSync(locked, '{ locked broken');
  mock.method(fs, 'renameSync', () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); });
  try {
    assert.equal(readJsonOrSetAside(locked), null);
  } finally {
    mock.restoreAll();
  }
  assert.equal(fs.readFileSync(`${locked}.corrupt`, 'utf8'), '{ locked broken', 'the copy holds the original bytes');
  assert.equal(fs.readFileSync(locked, 'utf8'), '{ locked broken', 'the original is left in place');
});
