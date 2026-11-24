// Fetches the feeds in feeds.ts on the PC and caches each feed's stories for 20 minutes.
// A feed that fails keeps its last good stories (marked stale), so the screen still has news.
import type { NewsFeedResponse, NewsItem, NewsSourceStatus } from '../api.ts';
import { parseFeed, sortNewest } from '../web/rss.ts';
import { FEEDS, type Feed } from './feeds.ts';
import { type CacheEntry, freshValue } from './cache.ts';

const TIMEOUT_MS = 8e3;
const MAX_CHARS = 2_000_000;   // a feed larger than this is cut short; the parser reads what fits

const good = new Map<string, CacheEntry<NewsItem[]>>();   // the last good stories for each feed id

function reason(e: unknown): string {
  const name = (e as Error)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'timed out';
  return String((e as Error)?.message || 'failed').slice(0, 120);
}

async function download(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'claude-os-news', Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.text()).slice(0, MAX_CHARS);
}

// One feed: its fresh cache, else a new download. A failure returns the last good stories, if any, as stale.
async function loadFeed(feed: Feed, now: number): Promise<{ status: NewsSourceStatus; items: NewsItem[]; at: number | null }> {
  const fresh = freshValue(good.get(feed.id), now);
  if (fresh) return { status: { id: feed.id, name: feed.name, status: 'ok', stale: false }, items: fresh, at: good.get(feed.id)!.at };
  try {
    const items = parseFeed(await download(feed.url), feed);
    if (!items.length) throw new Error('no stories in the feed');
    good.set(feed.id, { at: now, value: items });
    return { status: { id: feed.id, name: feed.name, status: 'ok', stale: false }, items, at: now };
  } catch (e) {
    const old = good.get(feed.id);
    return {
      status: { id: feed.id, name: feed.name, status: 'error', stale: !!old, error: reason(e) },
      items: old ? old.value : [],
      at: old ? old.at : null,
    };
  }
}

/** Every feed's stories, merged and sorted newest first. Never throws. */
export async function newsFeed(now: number = Date.now()): Promise<NewsFeedResponse> {
  const results = await Promise.all(FEEDS.map(feed => loadFeed(feed, now)));
  const failed = results.filter(r => r.status.status === 'error').length;
  const items = sortNewest(results.flatMap(r => r.items));
  const times = results.map(r => r.at).filter((t): t is number => t != null);
  return {
    status: failed === 0 ? 'ok' : items.length ? 'partial' : 'error',
    items,
    sources: results.map(r => r.status),
    updated: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
}
