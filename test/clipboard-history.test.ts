// ClaudeOS's clip history rules (src/core/web/clipboard-history.ts): pruning by count and age, and the token check.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLIP_TTL_MS, isTokenLike, pruneClips } from '../src/core/web/clipboard-history.ts';

const at = (text: string, t: number) => ({ text, at: t });

test('pruneClips keeps the newest five and drops anything older than ten minutes', () => {
  const now = 1_000_000;
  const list = [at('a', now), at('b', now - 1000), at('c', now - 2000), at('d', now - 3000), at('e', now - 4000), at('f', now - 5000)];
  assert.deepEqual(pruneClips(list, now).map(c => c.text), ['a', 'b', 'c', 'd', 'e']);

  const aged = [at('new', now - CLIP_TTL_MS + 1), at('old', now - CLIP_TTL_MS)];
  assert.deepEqual(pruneClips(aged, now).map(c => c.text), ['new']);
});

test('pruneClips returns nothing for an empty history', () => {
  assert.deepEqual(pruneClips([], 5), []);
});

test('isTokenLike flags keys, tokens and secrets', () => {
  assert.equal(isTokenLike('sk-ant-api03-AbCdEf1234567890xyz'), true);
  assert.equal(isTokenLike('ghp_1234567890abcdefghijklmnop'), true);
  assert.equal(isTokenLike('Authorization: Bearer abcdef1234567890XYZ'), true);
  assert.equal(isTokenLike('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIx.signature'), true);
  assert.equal(isTokenLike('x9f8e7d6c5b4a3f2e1d0c9b8a7'), true);
});

test('isTokenLike lets ordinary copies and web addresses through', () => {
  assert.equal(isTokenLike('Buy milk, eggs and bread.'), false);
  assert.equal(isTokenLike('https://example.com/articles/2026/11/23/some-long-slug-name'), false);
  assert.equal(isTokenLike('Call 555 0134 before 5pm'), false);
});
