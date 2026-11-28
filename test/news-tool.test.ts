// Claude's news_headlines tool (src/apps/news/server/tools.ts): the headlines, or a plain reason when there are none.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { newsHeadlines } from '../src/apps/news/server/tools.ts';

const item = (source: string, title: string) => ({ id: title, title, link: null, published: null, description: '', image: null, source, sourceId: source.toLowerCase(), });
const feed = (items: unknown[]) => async () => ({ items, statuses: [], at: 0 }) as never;

test('the headlines come as source and title, up to the count asked', async () => {
  const r = await newsHeadlines({ count: 2 }, feed([item('BBC News', 'Ships return'), item('Reuters', 'Markets rise'), item('AP', 'Third')]));
  assert.equal(r.content[0].text, 'BBC News: Ships return\nReuters: Markets rise');
});

test('no stories says why, and a failed read says it could not be read', async () => {
  const none = await newsHeadlines({}, feed([]));
  assert.equal(none.isError, true);
  assert.match(none.content[0].text, /No headlines/);
  const failed = await newsHeadlines({}, async () => { throw new Error('down'); });
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /couldn’t be read/);
});

test('the tool is wired into each session, and its approval card has plain words', () => {
  const turns = readFileSync(new URL('../src/apps/claude/server/turns.ts', import.meta.url), 'utf8');
  const cards = readFileSync(new URL('../src/apps/claude/web/tools.ts', import.meta.url), 'utf8');
  assert.ok(turns.includes("import { newsServer } from '../../news/server/tools.ts';"));
  assert.ok(turns.includes('claudeos_news: newsServer'));
  assert.ok(cards.includes("'mcp__claudeos_news__news_headlines': { now: 'Read the headlines', past: 'Read the headlines', doing: 'Reading the headlines' },"));
});

test('when every feed failed, the reply says the feeds did not answer, not that the topics are off', async () => {
  const r = await newsHeadlines({}, async () => ({ status: 'error', items: [], sources: [], updated: null }) as never);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /The news feeds did not answer/);
  assert.doesNotMatch(r.content[0].text, /switched off/);
});

test('a feed that failed is named after the headlines, and a saved one says it is showing the old stories', async () => {
  const r = await newsHeadlines({ count: 1 }, async () => ({ status: 'partial', items: [item('BBC News', 'Ships return')], sources: [{ id: 'a', name: 'AP', status: 'error', stale: true }, { id: 'b', name: 'BBC News', status: 'ok', stale: false }], updated: null }) as never);
  assert.equal(r.content[0].text, 'BBC News: Ships return\n(AP did not load (showing its stories from before).)');
});
