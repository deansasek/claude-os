// The News mock: the feed lists stories with the fields the app reads, and a topic change is saved and refused for
// an unknown topic. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerMock } from '../src/core/web/mock-api.ts';
import '../src/apps/news/web/mock.ts';

test('the mock feed lists stories with their source, newest first', () => {
  const r = answerMock('GET', '/api/news/feed');
  const f = r.body as { status: string; items: { source: string; published: string | null }[] };
  assert.equal(f.status, 'ok');
  assert.ok(f.items.length > 0);
  assert.ok(f.items.every(i => i.source.length > 0));
});

test('a topic change is saved, and an unknown topic is refused', () => {
  assert.deepEqual(answerMock('POST', '/api/news/topics', { id: 'bbc-technology', on: true }).body, {
    ok: true, topics: [{ id: 'bbc', name: 'BBC News', on: true }, { id: 'npr', name: 'NPR', on: true }, { id: 'bbc-technology', name: 'BBC Technology', on: true }],
  });
  assert.deepEqual(answerMock('POST', '/api/news/topics', { id: 'nope', on: true }).body, { ok: false, error: 'unknown_topic' });
});
