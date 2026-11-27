// The News feed and topics reads give up on a PC that does not answer, so the tablet does not stay on loading (src/apps/news/web/index.ts).
// The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/news/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function loadTopics(');
const topics = src.slice(start, src.indexOf('\n}\n', start));

test('the timeout is defined, and the feed and topics reads both pass it', () => {
  assert.match(src, /const NEWS_TIMEOUT_MS = 20e3;/);
  assert.match(src, /getJson<NewsFeedResponse>\('\/api\/news\/feed', NEWS_TIMEOUT_MS\)/);
  assert.match(topics, /getJson<NewsTopicsResponse>\('\/api\/news\/topics', NEWS_TIMEOUT_MS\)/);
});

test('a topics read that fails still marks the topics as failed', () => {
  assert.match(topics, /topicsFailed = true;/);
});
