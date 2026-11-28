// "What's the news" on the tablet reads the feeds on the tablet, as the News app does (src/apps/news/web/tablet.ts).
// The voice wiring is in voice-commands.ts (read as source). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { feedSource } from '../src/apps/news/web/tablet.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the feed source is the tablet when the tablet can fetch natively, and the PC otherwise', () => {
  assert.equal(feedSource(true), 'tablet');
  assert.equal(feedSource(false), 'pc');
});

test('the voice reads the tablet feeds when the tablet has newsFetch, and keeps the PC route as the fallback', () => {
  assert.ok(voice.includes("if (feedSource(nativeHas('newsFetch')) === 'tablet') {"));
  assert.ok(voice.includes('r = tabletFeed(newsFetch, newsStore, Date.now(), feeds);'));
  assert.ok(voice.includes("await getJson<NewsFeedResponse>('/api/news/feed', READ_TIMEOUT_MS)"));
});
