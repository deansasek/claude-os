// The News screen's choices, with no DOM: which state the page shows, the top story, the shelves, the notes for
// feeds that failed, the time a saved shelf was fetched, and whether a story can be opened. Tested in
// test/news-screen.test.ts. The page (web/index.ts) paints these choices and sets the text with textContent.
import type { NewsFeedResponse, NewsItem } from '../api.ts';

export interface Shelf { sourceId: string; name: string; stories: NewsItem[]; stale: boolean; when: string | null }
export interface Note { sourceId: string; text: string }
export type NewsScreen =
  | { state: 'error'; text: string }
  | { state: 'stories'; headline: NewsItem; shelves: Shelf[]; notes: Note[]; updated: string | null };

export const ERROR_TEXT = 'The news feeds did not answer. Check that the computer running ClaudeOS is connected to the internet. Tap Try again.';
export const NO_FEED_TEXT = 'ClaudeOS could not read the news from the computer. Tap Try again.';

/** The screen for one answer from /api/news/feed (null when the request itself failed). */
export function screenFor(res: NewsFeedResponse | null): NewsScreen {
  if (!res || res.status === 'error' || !res.items.length) return { state: 'error', text: res ? ERROR_TEXT : NO_FEED_TEXT };
  const headline = res.items[0];
  const shelves: Shelf[] = [];
  for (const s of res.sources) {
    // the top story sits in the headline card, so it is not repeated on its source's shelf
    const stories = res.items.filter(i => i.sourceId === s.id && i.id !== headline.id);
    if (stories.length) shelves.push({ sourceId: s.id, name: s.name, stories, stale: s.stale, when: s.stale ? res.updated : null });
  }
  const notes: Note[] = res.sources.filter(s => s.status === 'error').map(s => ({
    sourceId: s.id,
    text: `${s.name} did not load${s.error ? `: ${s.error}` : ''}.${s.stale ? ' Showing the stories it had before.' : ' Its stories are not shown.'}`,
  }));
  return { state: 'stories', headline, shelves, notes, updated: res.updated };
}

/** The link a story opens in the Browser app: http or https only, else null (no Read button). */
export function linkFor(item: NewsItem): string | null {
  if (!item.link) return null;
  try {
    const u = new URL(item.link);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}

/** How long ago a story came out, in plain words ("5 min ago"). Empty when the feed gave no valid date. */
export function ago(iso: string | null, now: number): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const m = Math.floor((now - t) / 60e3);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
