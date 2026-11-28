// Claude's news_topics tool lists the News topics and whether each is on (src/apps/news/server/tools.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { newsTopicsReply } from '../src/apps/news/server/tools.ts';

test('each topic comes with on or off, in the order Settings shows them', () => {
  const r = newsTopicsReply(() => ({ topics: [{ name: 'BBC News', on: true }, { name: 'Sport', on: false }] }));
  assert.equal(r.content[0].text, 'BBC News: on\nSport: off');
});

test('no topics says so, and a failed read says it could not be read', () => {
  const none = newsTopicsReply(() => ({ topics: [] }));
  assert.equal(none.isError, true);
  assert.match(none.content[0].text, /no News topics/);
  const failed = newsTopicsReply(() => { throw new Error('down'); });
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /couldn’t be read/);
});

test('the tool is wired in with the news tools, and its approval card has plain words', () => {
  const tools = readFileSync(new URL('../src/apps/news/server/tools.ts', import.meta.url), 'utf8');
  const cards = readFileSync(new URL('../src/apps/claude/web/tools.ts', import.meta.url), 'utf8');
  assert.ok(tools.includes("tool('news_topics',"));
  assert.ok(cards.includes("'mcp__claudeos_news__news_topics': { now: 'Check the news topics', past: 'Checked the news topics', doing: 'Checking the news topics' },"));
});
