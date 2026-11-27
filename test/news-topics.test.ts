// The News topics (#357): every topic starts on, a topic saved off drops its shelf from the feed, and an unknown topic
// name is refused. Uses a temp file for the choices and a fake download; the real news-topics.json is never touched.
// Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { FEEDS } from '../src/apps/news/web/feeds.ts';
import { activeFeeds, cleanChoices, topicRows, topicSaveError, topicsFor } from '../src/apps/news/web/topics.ts';
import { newsFeed } from '../src/apps/news/server/news.ts';
import { setTopic, topicChoices, topicsView } from '../src/apps/news/server/topics.ts';

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-news-topics-'));
const FILE = path.join(SCRATCH, 'news-topics.json');
const NOW = Date.parse('2026-11-24T10:00:00Z');
after(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

// Every feed answers with one story, so each shelf has a story to show.
const fakeGet = async (url: string): Promise<string> =>
  `<rss><channel><item><title>Story from ${url}</title><link>https://example.com/${encodeURIComponent(url)}</link><description>Summary.</description></item></channel></rss>`;

test('every topic is on when nothing is saved', () => {
  assert.deepEqual(topicChoices(FEEDS, FILE), {});
  assert.equal(activeFeeds(FEEDS, {}).length, FEEDS.length);
  assert.ok(topicsFor(FEEDS, {}).every(t => t.on));
  assert.ok(topicsView(FEEDS, FILE).topics.every(t => t.on));
  assert.ok(FEEDS.some(f => f.id === 'bbc'));   // News itself is a topic
});

test('a topic saved off drops its shelf from the feed, and the others stay', async () => {
  const saved = setTopic({ id: 'bbc-world', on: false }, FEEDS, FILE);
  assert.equal(saved.ok, true);
  const res = await newsFeed(NOW, activeFeeds(FEEDS, topicChoices(FEEDS, FILE)), fakeGet);
  const ids = res.sources.map(s => s.id);
  assert.ok(!ids.includes('bbc-world'), 'the off topic has no shelf');
  assert.ok(!res.items.some(i => i.sourceId === 'bbc-world'), 'no story from the off topic');
  assert.ok(ids.includes('bbc') && ids.includes('bbc-technology'), 'the topics that are on still have shelves');
  assert.equal(res.sources.length, FEEDS.length - 1);
  assert.equal(topicsView(FEEDS, FILE).topics.find(t => t.id === 'bbc-world')?.on, false);

  setTopic({ id: 'bbc-world', on: true }, FEEDS, FILE);
  assert.equal(topicChoices(FEEDS, FILE)['bbc-world'], true);
});

test('an unknown topic name is refused and nothing is saved', () => {
  const before = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : null;
  assert.deepEqual(setTopic({ id: 'sport', on: false }, FEEDS, FILE), { ok: false, error: 'unknown_topic' });
  assert.deepEqual(setTopic({ on: false }, FEEDS, FILE), { ok: false, error: 'unknown_topic' });
  assert.deepEqual(setTopic({ id: 'bbc', on: 'no' }, FEEDS, FILE), { ok: false, error: 'bad_value' });
  assert.equal(fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : null, before);
});

test('unknown names in the saved file are dropped', () => {
  assert.deepEqual(cleanChoices({ bbc: false, sport: false, npr: 'yes' }, FEEDS), { bbc: false });
  assert.deepEqual(cleanChoices(null, FEEDS), {});
});

test('topic rows: loaded shows one switch per topic that reflects the choices', () => {
  const rows = topicRows(FEEDS, { 'bbc-world': false }, 'loaded', async () => {});
  assert.equal(rows.length, FEEDS.length);
  assert.ok(rows.every(r => r.kind === 'switch'));
  const off = rows.find(r => r.id === 'topic-bbc-world');
  assert.ok(off && off.kind === 'switch' && off.get() === false);
  const on = rows.find(r => r.id === 'topic-bbc');
  assert.ok(on && on.kind === 'switch' && on.get() === true);
});

test('topic rows: a switch saves through the callback with its topic id', async () => {
  const saved: [string, boolean][] = [];
  const rows = topicRows(FEEDS, {}, 'loaded', async (id, on) => { saved.push([id, on]); });
  const row = rows.find(r => r.id === 'topic-bbc-world');
  assert.ok(row && row.kind === 'switch');
  await row.set(false);
  assert.deepEqual(saved, [['bbc-world', false]]);
});

test('topic rows: loading shows an info row, not switches', () => {
  const rows = topicRows(FEEDS, {}, 'loading', async () => {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'info');
  assert.equal(rows[0].kind === 'info' && rows[0].value(), 'Loading…');
});

test('a topic not saved with no PC answer says the PC cannot be reached', () => {
  assert.equal(topicSaveError(null), 'Can’t reach your PC. Check it’s on, then try again.');
});

test('a topic the PC answers without saving says the PC could not save it, not the connection', () => {
  const msg = topicSaveError({ ok: false });
  assert.equal(msg, 'The PC couldn’t save that topic. Try again.');
  assert.doesNotMatch(msg, /connect|reach|check/i);
});

test('topic rows: failed shows an info row with the PC detail, not switches', () => {
  const rows = topicRows(FEEDS, {}, 'failed', async () => {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'info');
  assert.equal(rows[0].detail, 'Can’t reach the PC right now.');
  assert.equal(rows[0].kind === 'info' && rows[0].value(), 'Couldn’t load');
});

test('a topic switched to the state it already has writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-news-noop-'));
  const file = path.join(dir, 'news-topics.json');
  try {
    assert.equal(setTopic({ id: 'bbc', on: true }, FEEDS, file).ok, true);
    assert.equal(fs.existsSync(file), false, 'on, which is already the state, is not saved');
    assert.equal(setTopic({ id: 'bbc', on: false }, FEEDS, file).ok, true);
    const before = fs.readFileSync(file, 'utf8');
    assert.equal(setTopic({ id: 'bbc', on: false }, FEEDS, file).ok, true);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a save the PC cannot make is refused with a code, not thrown, and leaves no file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-news-save-'));
  try {
    const file = path.join(dir, 'missing-dir', 'news-topics.json');
    assert.deepEqual(setTopic({ id: 'bbc', on: false }, FEEDS, file), { ok: false, error: 'save_failed' });
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
