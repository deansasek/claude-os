// The News cache rule: a feed's stories are fresh for 20 minutes. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freshValue, isFresh, NEWS_TTL_MS } from '../src/apps/news/server/cache.ts';

const T0 = Date.parse('2026-11-24T10:00:00Z');

test('the news TTL is inside the 15 to 30 minute range', () => {
  assert.ok(NEWS_TTL_MS >= 15 * 60e3 && NEWS_TTL_MS <= 30 * 60e3);
});

test('a fetch is fresh until the TTL has passed, then stale', () => {
  assert.equal(isFresh(T0, T0), true);
  assert.equal(isFresh(T0, T0 + NEWS_TTL_MS - 1), true);
  assert.equal(isFresh(T0, T0 + NEWS_TTL_MS), false);
  assert.equal(isFresh(T0, T0 + 60 * 60e3), false);
});

test('a clock that went backwards counts as stale', () => {
  assert.equal(isFresh(T0, T0 - 1), false);
});

test('freshValue returns the stories only while they are fresh', () => {
  const entry = { at: T0, value: ['story'] };
  assert.deepEqual(freshValue(entry, T0 + 5 * 60e3), ['story']);
  assert.equal(freshValue(entry, T0 + NEWS_TTL_MS), null);
  assert.equal(freshValue(undefined, T0), null);
});
