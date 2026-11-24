// Fetches the feeds in web/feeds.ts on the PC and caches each feed's stories for 20 minutes.
// A feed that fails keeps its last good stories (marked stale), so the screen still has news.
import type { NewsFeedResponse, NewsItem, NewsSourceStatus } from '../api.ts';
import { parseFeed } from '../web/rss.ts';
import { combineFeeds, type FeedResult } from '../web/combine.ts';
import { FEEDS, type Feed } from '../web/feeds.ts';
import { activeFeeds } from '../web/topics.ts';
import { type CacheEntry, freshValue } from './cache.ts';
import { topicChoices } from './topics.ts';

const TIMEOUT_MS = 8e3;
const MAX_CHARS = 2_000_000;   // a feed larger than this is cut short; the parser reads what fits

const good = new Map<string, CacheEntry<NewsItem[]>>();   // the last good stories for each feed id

function reason(e: unknown): string {
  const name = (e as Error)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'timed out';
  return String((e as Error)?.message || 'failed').slice(0, 120);
}

type Get = (url: string) => Promise<string>;

async function download(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'claude-os-news', Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.text()).slice(0, MAX_CHARS);
}

// One feed: its fresh cache, else a new download. A failure returns the last good stories, if any, as stale.
async function loadFeed(feed: Feed, now: number, get: Get): Promise<FeedResult> {
  const fresh = freshValue(good.get(feed.id), now);
  if (fresh) return { status: { id: feed.id, name: feed.name, status: 'ok', stale: false }, items: fresh, at: good.get(feed.id)!.at };
  try {
    const items = parseFeed(await get(feed.url), feed);
    if (!items.length) throw new Error('no stories in the feed');
    good.set(feed.id, { at: now, value: items });
    return { status: { id: feed.id, name: feed.name, status: 'ok', stale: false }, items, at: now };
  } catch (e) {
    const old = good.get(feed.id);
    const status: NewsSourceStatus = { id: feed.id, name: feed.name, status: 'error', stale: !!old, error: reason(e) };
    if (old) status.fetched = new Date(old.at).toISOString();
    return { status, items: old ? old.value : [], at: old ? old.at : null };
  }
}

/** Every topic that is on: its stories, merged and sorted newest first. A topic that is off is not fetched. Never throws. */
export async function newsFeed(now: number = Date.now(), feeds: Feed[] = activeFeeds(FEEDS, topicChoices()), get: Get = download): Promise<NewsFeedResponse> {
  return combineFeeds(await Promise.all(feeds.map(feed => loadFeed(feed, now, get))));
}
