// The News feeds read on the tablet, through the native fetch (NewsFetch.java). The feeds send no CORS header, so the
// page cannot read them itself. Each feed's last good stories are kept in local storage with the time they were read,
// and a feed that fails shows those saved stories, marked stale. No DOM here: the caller passes the native fetch and
// the storage, so the tests can run it (test/news-tablet.test.ts).
import type { NewsFeedResponse, NewsItem } from '../api.ts';
import { combineFeeds, type FeedResult } from './combine.ts';
import { FEEDS, type Feed } from './feeds.ts';
import { parseFeed } from './rss.ts';

export const SAVED_KEY = 'news.feeds.v1';

export interface SavedFeed { at: number; items: NewsItem[] }
export type Saved = Record<string, SavedFeed>;
export type NativeFetch = (url: string) => { status: number; body: string };
export interface KeyValue { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** Which route the page uses: the tablet's native fetch when the app has it, else the PC route. */
export function feedSource(hasNative: boolean): 'tablet' | 'pc' {
  return hasNative ? 'tablet' : 'pc';
}

/** The saved stories. Empty when storage is empty, blocked or holds bad data. Never throws. */
export function readSaved(store: KeyValue): Saved {
  const out: Saved = {};
  try {
    const raw: unknown = JSON.parse(store.getItem(SAVED_KEY) || '{}');
    if (!raw || typeof raw !== 'object') return out;
    for (const [id, entry] of Object.entries(raw as Record<string, Partial<SavedFeed>>)) {
      if (entry && Number.isFinite(entry.at) && Array.isArray(entry.items)) out[id] = { at: entry.at!, items: entry.items };
    }
  } catch { /* bad JSON: start with nothing saved */ }
  return out;
}

function reason(e: unknown): string {
  return String((e as Error)?.message || 'failed').slice(0, 120);
}

// One feed read now. A failure keeps the saved stories for that feed, marked stale with the time they were read.
function readFeed(feed: Feed, fetchNative: NativeFetch, saved: Saved, now: number): FeedResult {
  try {
    const r = fetchNative(feed.url);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const items = parseFeed(r.body, feed);
    if (!items.length) throw new Error('no stories in the feed');
    saved[feed.id] = { at: now, items };
    return { status: { id: feed.id, name: feed.name, status: 'ok', stale: false }, items, at: now };
  } catch (e) {
    const old = saved[feed.id];
    return {
      status: {
        id: feed.id, name: feed.name, status: 'error', stale: !!old, error: reason(e),
        ...(old ? { fetched: new Date(old.at).toISOString() } : {}),
      },
      items: old ? old.items : [],
      at: old ? old.at : null,
    };
  }
}

/** The News answer from the tablet: every feed read natively, the good reads saved, the rest from the saved copies. Never throws. */
export function tabletFeed(fetchNative: NativeFetch, store: KeyValue, now: number, feeds: Feed[] = FEEDS): NewsFeedResponse {
  const saved = readSaved(store);
  const results = feeds.map(feed => readFeed(feed, fetchNative, saved, now));
  try { store.setItem(SAVED_KEY, JSON.stringify(saved)); } catch { /* storage full or blocked: the stories still show */ }
  return combineFeeds(results);
}
