// Merges the per-feed results into one News answer. Shared by the PC route (server/news.ts) and the tablet (tablet.ts).
import type { NewsFeedResponse, NewsItem, NewsSourceStatus } from '../api.ts';
import { sortNewest } from './rss.ts';

export interface FeedResult { status: NewsSourceStatus; items: NewsItem[]; at: number | null }

/** All feeds in one answer: stories merged newest first, each feed's status, and the newest fetch time. */
export function combineFeeds(results: FeedResult[]): NewsFeedResponse {
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
