// The News screen's rules, with no DOM: the states (ok, partial, error), the headline and shelves, the notes for a
// failed feed, and the saved time on a stale shelf. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NewsFeedResponse, NewsItem } from '../src/apps/news/api.ts';
import { ago, screenFor, ERROR_TEXT, NO_FEED_TEXT } from '../src/apps/news/web/screen.ts';

const T = '2026-11-24T10:00:00Z';
const story = (id: string, sourceId: string, extra: Partial<NewsItem> = {}): NewsItem => ({
  id, title: `Story ${id}`, link: `https://example.com/${id}`, published: '2026-11-24T09:50:00Z',
  description: 'Summary.', image: null, source: sourceId === 'bbc' ? 'BBC News' : 'NPR', sourceId, ...extra,
});
const bbc = (stale = false, error = false) => ({ id: 'bbc', name: 'BBC News', status: error ? 'error' as const : 'ok' as const, stale, ...(error ? { error: 'timed out' } : {}) });
const npr = (stale = false, error = false) => ({ id: 'npr', name: 'NPR', status: error ? 'error' as const : 'ok' as const, stale, ...(error ? { error: 'HTTP 503' } : {}) });

test('ok: the newest story is the headline and each feed gets a shelf without it', () => {
  const res: NewsFeedResponse = {
    status: 'ok', updated: T,
    items: [story('a', 'bbc'), story('b', 'npr'), story('c', 'bbc')],
    sources: [bbc(), npr()],
  };
  const s = screenFor(res);
  assert.equal(s.state, 'stories');
  if (s.state !== 'stories') return;
  assert.equal(s.headline.id, 'a');
  assert.deepEqual(s.shelves.map(x => [x.name, x.stories.map(i => i.id)]), [['BBC News', ['c']], ['NPR', ['b']]]);
  assert.deepEqual(s.notes, []);
  assert.ok(s.shelves.every(x => x.stale === false && x.when === null));
});

test('partial: the stories show, and a note names the feed that failed', () => {
  const res: NewsFeedResponse = {
    status: 'partial', updated: T,
    items: [story('a', 'bbc'), story('b', 'bbc')],
    sources: [bbc(), npr(false, true)],
  };
  const s = screenFor(res);
  assert.equal(s.state, 'stories');
  if (s.state !== 'stories') return;
  assert.equal(s.headline.id, 'a');
  assert.equal(s.shelves.length, 1);
  assert.equal(s.notes.length, 1);
  assert.equal(s.notes[0].sourceId, 'npr');
  assert.match(s.notes[0].text, /^NPR did not load: HTTP 503\./);
  assert.match(s.notes[0].text, /Its stories are not shown\.$/);
});

test('partial with a stale feed: its shelf says the fetch time, and the note says saved stories show', () => {
  const res: NewsFeedResponse = {
    status: 'partial', updated: T,
    items: [story('a', 'bbc'), story('b', 'npr'), story('c', 'npr')],
    sources: [bbc(), npr(true, true)],
  };
  const s = screenFor(res);
  if (s.state !== 'stories') assert.fail('expected stories');
  const shelf = s.shelves.find(x => x.sourceId === 'npr');
  assert.ok(shelf);
  assert.equal(shelf.stale, true);
  assert.equal(shelf.when, T);
  assert.match(s.notes[0].text, /Showing the stories it had before\.$/);
});

test('error: every feed failed with no saved stories, so the page shows the error message', () => {
  const res: NewsFeedResponse = { status: 'error', updated: null, items: [], sources: [bbc(false, true), npr(false, true)] };
  assert.deepEqual(screenFor(res), { state: 'error', text: ERROR_TEXT });
});

test('error: an ok answer with no stories is still an error, never an empty list', () => {
  const res: NewsFeedResponse = { status: 'ok', updated: T, items: [], sources: [bbc(), npr()] };
  assert.equal(screenFor(res).state, 'error');
});

test('error: a request that failed altogether shows the plain message', () => {
  assert.deepEqual(screenFor(null), { state: 'error', text: NO_FEED_TEXT });
});

test('ago says how old a story is in plain words', () => {
  const now = Date.parse(T);
  assert.equal(ago(T, now), 'Just now');
  assert.equal(ago('2026-11-24T09:50:00Z', now), '10 min ago');
  assert.equal(ago('2026-11-24T07:00:00Z', now), '3 h ago');
  assert.equal(ago('2026-11-21T10:00:00Z', now), '3 d ago');
  assert.equal(ago(null, now), '');
  assert.equal(ago('not a date', now), '');
});
