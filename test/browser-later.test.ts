// The Reading list undo check: a removed entry goes back at its old place, without a duplicate. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restoreLater } from '../src/apps/browser/web/later.ts';

const a = { url: 'https://a.example', title: 'A' };
const b = { url: 'https://b.example', title: 'B' };
const c = { url: 'https://c.example', title: 'C' };

test('a removed entry goes back at its old index', () => {
  assert.deepEqual(restoreLater([a, c], b, 1), [a, b, c]);
});

test('a removed entry goes at the end when the list got shorter', () => {
  assert.deepEqual(restoreLater([a], c, 5), [a, c]);
});

test('no duplicate when the same url was saved again', () => {
  const again = { url: 'https://b.example', title: 'B again' };
  assert.deepEqual(restoreLater([a, again, c], b, 1), [a, b, c]);
});
