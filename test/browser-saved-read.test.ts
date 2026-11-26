// The saved Browser lists: a value that is not a list gives null (the default), and bad entries are left out. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasNumberId, hasStringId, hasUrl, readSavedList, readSavedObject } from '../src/apps/browser/web/saved-list.ts';

test('a saved value that is not a list gives null, so the default is used', () => {
  assert.equal(readSavedList('{}', hasUrl), null);
  assert.equal(readSavedList('5', hasUrl), null);
  assert.equal(readSavedList('"x"', hasUrl), null);
  assert.equal(readSavedList(null, hasUrl), null);
  assert.equal(readSavedList('{ broken', hasUrl), null);
});

test('entries that fail their check are left out, and the good ones are kept', () => {
  const raw = JSON.stringify([null, 3, { title: 'no url' }, { url: 'https://a.example' }]);
  assert.deepEqual(readSavedList(raw, hasUrl), [{ url: 'https://a.example' }]);
  assert.deepEqual(readSavedList(JSON.stringify([{ id: 'a' }, { id: 7 }]), hasStringId), [{ id: 'a' }]);
  assert.deepEqual(readSavedList(JSON.stringify([{ id: 1 }, { id: 'x' }]), hasNumberId), [{ id: 1 }]);
});

test('permissions must be a plain object', () => {
  assert.deepEqual(readSavedObject('{"camera":"ask"}'), { camera: 'ask' });
  assert.equal(readSavedObject('[1]'), null);
  assert.equal(readSavedObject('7'), null);
});

test('a saved history visit with no string title or a bad time is left out, and a good one is kept', async () => {
  const { isVisit } = await import('../src/apps/browser/web/saved-list.ts');
  const raw = JSON.stringify([{ url: 'https://a.example', at: 1 }, { url: 'https://b.example', title: 'B', at: 2 }, { url: 'https://c.example', title: 7, at: 3 }, { url: 'https://d.example', title: 'D', at: 'x' }]);
  assert.deepEqual(readSavedList(raw, isVisit), [{ url: 'https://b.example', title: 'B', at: 2 }]);
});
