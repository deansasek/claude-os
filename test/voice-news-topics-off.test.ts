// "What's the news" on the tablet skips the topics switched off in Settings (src/core/web/voice-commands.ts).
// The read is checked as source; the filter is the News app's own activeFeeds. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FEEDS } from '../src/apps/news/web/feeds.ts';
import { activeFeeds } from '../src/apps/news/web/topics.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a topic switched off is left out of the feeds read', () => {
  const off = FEEDS[0].id;
  const on = activeFeeds(FEEDS, { [off]: false });
  assert.equal(on.some(f => f.id === off), false);
  assert.equal(on.length, FEEDS.length - 1);
});

test('with no choices made, every topic is on', () => {
  assert.equal(activeFeeds(FEEDS, {}).length, FEEDS.length);
});

test('the voice reads the topics from the PC, and falls back to every feed when they cannot be read', () => {
  assert.ok(voice.includes("getJson<{ topics?: { id: string; on: boolean }[] }>('/api/news/topics', READ_TIMEOUT_MS)"));
  assert.ok(voice.includes('feeds = activeFeeds(FEEDS, Object.fromEntries(tp.topics.map(x => [x.id, x.on])));'));
  assert.ok(voice.includes('} catch { /* the topics cannot be read: read every feed, as before */ }'));
});
