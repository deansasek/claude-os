// The reader article check: a page with no readable text gives no article. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { articleOf } from '../src/apps/browser/web/reader.ts';

test('empty reader text gives no article', () => {
  assert.equal(articleOf(''), null);
});

test('bad reader JSON gives no article', () => {
  assert.equal(articleOf('{not json'), null);
});

test('an article with no blocks gives no article', () => {
  assert.equal(articleOf(JSON.stringify({ title: 'Empty', blocks: [] })), null);
});

test('an article with at least one block gives the article', () => {
  const json = JSON.stringify({ title: 'Story', host: 'example.com', blocks: [{ tag: 'p', text: 'Hello.' }] });
  assert.deepEqual(articleOf(json), { title: 'Story', host: 'example.com', blocks: [{ tag: 'p', text: 'Hello.' }] });
});
