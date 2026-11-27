// A Radio station search with extra spaces finds the same stations as one with single spaces (src/apps/radio/api.ts cleanQuery).
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanQuery } from '../src/apps/radio/api.ts';

test('runs of spaces become one, and the ends are cut', () => {
  assert.equal(cleanQuery('  jazz   fm \n'), 'jazz fm');
  assert.equal(cleanQuery('bbc   radio 2'), 'bbc radio 2');
});

test('a search is at most 60 characters', () => {
  assert.equal(cleanQuery('a'.repeat(70)).length, 60);
});

test('a search of only spaces is empty', () => {
  assert.equal(cleanQuery('   '), '');
});
