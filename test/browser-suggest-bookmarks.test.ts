// The address-bar suggestions also list matching bookmarks (src/apps/browser/web/state.ts suggestMatches).
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
// state.ts imports core/web/dom.ts, which reads the page's location when it loads; node has none, so give it one first.
Object.assign(globalThis, { location: { search: '' } });
const { suggestMatches } = await import('../src/apps/browser/web/state.ts');
import type { Bookmark, Visit } from '../src/apps/browser/web/state.ts';

const visit = (url: string, title: string): Visit => ({ url, title, at: 1 });
const mark = (url: string, title: string): Bookmark => ({ url, title, at: 1 });

test('a bookmark matches even when its visit has left history', () => {
  const hits = suggestMatches('bbc', [], [mark('https://www.bbc.co.uk/news', 'BBC News')], 5);
  assert.deepEqual(hits, [{ kind: 'bookmark', url: 'https://www.bbc.co.uk/news', title: 'BBC News' }]);
});

test('bookmarks are listed before history', () => {
  const hits = suggestMatches('recipe', [visit('https://a.test/recipe-1', 'Recipe one')], [mark('https://b.test/recipe-2', 'Recipe two')], 5);
  assert.deepEqual(hits.map(h => h.kind), ['bookmark', 'history']);
  assert.equal(hits[0].url, 'https://b.test/recipe-2');
});

test('a URL that is both a bookmark and a visit is listed once, as the bookmark', () => {
  const url = 'https://school.test/home';
  const hits = suggestMatches('school', [visit(url, 'School')], [mark(url, 'School home')], 5);
  assert.deepEqual(hits, [{ kind: 'bookmark', url, title: 'School home' }]);
});

test('the match runs on the URL as well as the title', () => {
  const hits = suggestMatches('weather', [], [mark('https://weather.test/', '')], 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, '');
});

test('a bookmark whose title is not a string counts as an empty title', () => {
  const bad = { url: 'https://c.test/x', title: 42, at: 1 } as unknown as Bookmark;
  const hits = suggestMatches('c.test', [], [bad], 5);
  assert.deepEqual(hits, [{ kind: 'bookmark', url: 'https://c.test/x', title: '' }]);
});

test('no match gives an empty list, and the cap holds', () => {
  assert.deepEqual(suggestMatches('zzz', [visit('https://a.test/', 'A')], [mark('https://b.test/', 'B')], 5), []);
  const many = Array.from({ length: 10 }, (_, i) => mark(`https://site${i}.test/`, 'site'));
  assert.equal(suggestMatches('site', [], many, 5).length, 5);
  assert.equal(suggestMatches('site', [], many, 0).length, 0);
});
