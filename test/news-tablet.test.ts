// The News feeds read on the tablet (web/tablet.ts): one native read per feed, saved stories with their read time,
// the stale note on a failed feed, bad storage, and the route choice. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEEDS } from '../src/apps/news/web/feeds.ts';
import { screenFor } from '../src/apps/news/web/screen.ts';
import { feedSource, readSaved, SAVED_KEY, tabletFeed, type KeyValue, type NativeFetch } from '../src/apps/news/web/tablet.ts';

const BBC = 'https://feeds.bbci.co.uk/news/rss.xml';
const NPR = 'https://feeds.npr.org/1001/rss.xml';
// the two feeds this file's fixtures answer; the topics added later (#357) are read only when a test asks for them
const TWO = FEEDS.filter(f => f.id === 'bbc' || f.id === 'npr');
const NOW = Date.parse('2026-11-24T10:00:00Z');
const EARLIER = NOW - 3 * 3600e3;

const ok = (title: string) => ({
  status: 200,
  body: `<rss><channel><item><title>${title}</title><link>https://example.com/${title}</link><description>Summary.</description></item></channel></rss>`,
});
const fail = (status: number) => ({ status, body: '' });

// A native fetch answering each feed URL. An unknown URL is refused, as NewsFetch.java refuses it.
function native(answers: Record<string, () => { status: number; body: string }>): NativeFetch {
  return url => {
    const f = answers[url];
    if (!f) throw new Error('host not allowed');
    return f();
  };
}

function memory(seed?: string): KeyValue {
  const m = new Map<string, string>();
  if (seed !== undefined) m.set(SAVED_KEY, seed);
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}

test('both feeds are read natively, and the good reads are saved with their read time', () => {
  const store = memory();
  const res = tabletFeed(native({ [BBC]: () => ok('bbc-1'), [NPR]: () => ok('npr-1') }), store, NOW, TWO);
  assert.equal(res.status, 'ok');
  assert.equal(res.items.length, 2);
  assert.ok(res.sources.every(s => s.status === 'ok' && !s.stale && s.fetched === undefined));
  assert.equal(readSaved(store).bbc.at, NOW);
});

test('a failed feed shows its saved stories, marked stale with the time they were read', () => {
  const store = memory();
  tabletFeed(native({ [BBC]: () => ok('bbc-old'), [NPR]: () => ok('npr-old') }), store, EARLIER, TWO);
  const res = tabletFeed(native({ [BBC]: () => ok('bbc-new'), [NPR]: () => fail(503) }), store, NOW, TWO);
  assert.equal(res.status, 'partial');
  const npr = res.sources.find(s => s.id === 'npr')!;
  assert.deepEqual([npr.stale, npr.error, npr.fetched], [true, 'HTTP 503', new Date(EARLIER).toISOString()]);
  const screen = screenFor(res);
  assert.equal(screen.state === 'stories' && screen.shelves.find(s => s.sourceId === 'npr')!.when, new Date(EARLIER).toISOString());
});

test('a feed that fails with nothing saved, or has no stories, is an error for that feed', () => {
  const res = tabletFeed(native({ [BBC]: () => fail(503), [NPR]: () => ({ status: 200, body: '<rss></rss>' }) }), memory(), NOW, TWO);
  assert.equal(res.status, 'error');
  assert.deepEqual(res.sources.map(s => s.error), ['HTTP 503', 'no stories in the feed']);
  assert.equal(res.updated, null);
});

test('bad or blocked storage is ignored and the read still works', () => {
  assert.deepEqual(readSaved(memory('{not json')), {});
  assert.deepEqual(readSaved(memory('{"bbc":{"at":"soon","items":3}}')), {});
  const blocked: KeyValue = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
  const res = tabletFeed(native({ [BBC]: () => ok('bbc-1'), [NPR]: () => ok('npr-1') }), blocked, NOW, TWO);
  assert.equal(res.status, 'ok');
});

test('the PC route is used when the tablet app has no native feed read', () => {
  assert.equal(feedSource(false), 'pc');
  assert.equal(feedSource(true), 'tablet');
});
