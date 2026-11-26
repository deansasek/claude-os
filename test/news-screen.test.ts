// The News screen's rules, with no DOM: the states (ok, partial, error), the headline and shelves, the notes for a
// failed feed, the saved time on a stale shelf, the Read link (none for a story without a link), the feed terms
// (no picture, text unchanged, a tile opens the reader, poll at most every 15 minutes), and the stale note after a
// failed refresh. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import type { NewsFeedResponse, NewsItem } from '../src/apps/news/api.ts';
import { parseFeed } from '../src/apps/news/web/rss.ts';
import {
  ago, linkFor, pictureFor, POLL_MS, readerFor, screenFor, SHOW_IMAGES, staleNotes, STALE_TEXT, storiesById, storyKey, ERROR_TEXT, NO_FEED_TEXT, NO_SUMMARY_TEXT,
} from '../src/apps/news/web/screen.ts';

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

test('a story with an http or https link can be read', () => {
  assert.equal(linkFor(story('a', 'bbc')), 'https://example.com/a');
  assert.equal(linkFor(story('a', 'bbc', { link: 'http://example.com/x' })), 'http://example.com/x');
});

test('a story without a link gets no Read link', () => {
  assert.equal(linkFor(story('a', 'bbc', { link: null })), null);
  assert.equal(linkFor(story('a', 'bbc', { link: '' })), null);
  assert.equal(linkFor(story('a', 'bbc', { link: 'javascript:alert(1)' })), null);
  assert.equal(linkFor(story('a', 'bbc', { link: 'not a link' })), null);
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

test('feed terms: no feed picture is shown while SHOW_IMAGES is off', () => {
  assert.equal(SHOW_IMAGES, false);
  assert.equal(pictureFor(story('a', 'bbc', { image: 'https://img.example.com/a.jpg' })), null);
  assert.equal(pictureFor(story('a', 'bbc', { image: null })), null);
});

test('feed terms: the feed title and description reach the reader unchanged, with no cut', () => {
  const long = 'Word '.repeat(120).trim();   // 599 characters
  const xml = `<rss><channel><item><title>Exact &amp; title</title><link>https://example.com/x</link>
    <description><![CDATA[<p>${long}</p>]]></description><pubDate>Tue, 24 Nov 2026 09:00:00 GMT</pubDate></item></channel></rss>`;
  const [item] = parseFeed(xml, { id: 'bbc', name: 'BBC News' });
  assert.equal(item.title, 'Exact & title');
  assert.equal(item.description, long);
  const s = screenFor({ status: 'ok', updated: T, items: [item], sources: [bbc()] });
  if (s.state !== 'stories') assert.fail('expected stories');
  assert.equal(s.headline.title, item.title);
  assert.equal(s.headline.description, long);
  const r = readerFor(item, Date.parse(T));
  assert.equal(r.title, 'Exact & title');
  assert.equal(r.description, long);
  assert.equal(r.source, 'BBC News');
});

test('feed terms: a story with no summary gets the plain note, not a made-up summary', () => {
  assert.equal(readerFor(story('a', 'bbc', { description: '' }), Date.parse(T)).description, NO_SUMMARY_TEXT);
});

test('a tile opens the reader with that story, and the reader links to its original', () => {
  const res: NewsFeedResponse = {
    status: 'ok', updated: T,
    items: [story('a', 'bbc'), story('b', 'npr', { title: 'NPR tile', description: 'NPR words.' }), story('c', 'bbc')],
    sources: [bbc(), npr()],
  };
  const s = screenFor(res);
  if (s.state !== 'stories') assert.fail('expected stories');
  const byId = storiesById(s);
  // every tile on the screen (the shelves) finds its story; the headline is in the map too
  for (const shelf of s.shelves) for (const tileStory of shelf.stories) assert.ok(byId.has(storyKey(tileStory)));
  const r = readerFor(byId.get(storyKey(story('b', 'npr')))!, Date.parse(T));
  assert.equal(r.title, 'NPR tile');
  assert.equal(r.description, 'NPR words.');
  assert.equal(r.link, 'https://example.com/b');
  assert.equal(r.source, 'NPR');
});

test('the same story id in two feeds: each storyKey gives the item with its own source', () => {
  const res: NewsFeedResponse = {
    status: 'ok', updated: T,
    items: [story('a', 'bbc'), story('x', 'bbc'), story('x', 'npr')],
    sources: [bbc(), npr()],
  };
  const s = screenFor(res);
  if (s.state !== 'stories') assert.fail('expected stories');
  const byId = storiesById(s);
  assert.equal(byId.get(storyKey(story('x', 'bbc')))?.sourceId, 'bbc');
  assert.equal(byId.get(storyKey(story('x', 'bbc')))?.source, 'BBC News');
  assert.equal(byId.get(storyKey(story('x', 'npr')))?.sourceId, 'npr');
  assert.equal(byId.get(storyKey(story('x', 'npr')))?.source, 'NPR');
});

test('the page asks for the feed no more often than every 15 minutes', () => {
  assert.ok(POLL_MS >= 15 * 60e3);
});

test('a failed refresh with stories on screen gets the stale note, in the page copy style', () => {
  assert.equal(STALE_TEXT, 'ClaudeOS could not reach the computer. These stories may be out of date.');
  assert.deepEqual(staleNotes(), [{ sourceId: '', text: STALE_TEXT }]);
});

test('load(): the stale branch shows the note, restores topicsDirty and sets loadedAt to 0', () => {
  const src = fs.readFileSync(new URL('../src/apps/news/web/index.ts', import.meta.url), 'utf8');
  const start = src.indexOf('async function load()');
  const end = src.indexOf('// ---------- opening the original story');
  assert.ok(start >= 0 && end > start, 'load() is in index.ts');
  const body = src.slice(start, end);
  assert.match(body, /const wasDirty = topicsDirty;/);
  const stale = body.slice(body.indexOf('if (!res && hasStories)'), body.indexOf('const s = screenFor(res)'));
  assert.match(stale, /staleNotes\(\)/);
  assert.match(stale, /if \(wasDirty\) topicsDirty = true;/);
  assert.match(stale, /loadedAt = 0;/);
  assert.match(stale, /return;/);
});
