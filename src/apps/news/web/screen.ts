// The News screen's choices, with no DOM: which state the page shows, the top story, the shelves, the notes for
// feeds that failed, the time a saved shelf was fetched, whether a story can be opened, and the reader's text.
// The feed's own words are passed through unchanged (feed terms, #357). Tested in test/news-screen.test.ts.
// The page (web/index.ts) paints these choices and sets the text with textContent.
import type { NewsFeedResponse, NewsItem } from '../api.ts';

export interface Shelf { sourceId: string; name: string; stories: NewsItem[]; stale: boolean; when: string | null }
export interface Note { sourceId: string; text: string }
export type NewsScreen =
  | { state: 'error'; text: string }
  | { state: 'stories'; headline: NewsItem; shelves: Shelf[]; notes: Note[]; updated: string | null };

export const ERROR_TEXT = 'The news feeds did not answer. Check that the computer running ClaudeOS is connected to the internet. Tap Try again.';
export const NO_FEED_TEXT = 'ClaudeOS could not read the news from the computer. Tap Try again.';
export const NO_SUMMARY_TEXT = 'The feed gave no summary for this story.';
export const NO_TOPIC_TEXT = 'Every News topic is off. Turn one on in Settings, then tap Try again.';
export const STALE_TEXT = 'ClaudeOS could not reach the computer. These stories may be out of date.';

// Feed terms (#357): no feed picture is shown until the owner confirms the BBC image licence. The code path stays.
export const SHOW_IMAGES = false;
// Feed terms (#357): the page asks for the feed no more often than this, while it is on screen or when it is shown.
export const POLL_MS = 15 * 60e3;

/** The screen for one answer from /api/news/feed (null when the request itself failed). */
export function screenFor(res: NewsFeedResponse | null): NewsScreen {
  if (res && !res.sources.length) return { state: 'error', text: NO_TOPIC_TEXT };   // every topic is off
  if (!res || res.status === 'error' || !res.items.length) return { state: 'error', text: res ? ERROR_TEXT : NO_FEED_TEXT };
  const headline = res.items[0];
  const shelves: Shelf[] = [];
  for (const s of res.sources) {
    // the top story sits in the headline card, so it is not repeated on its source's shelf
    const stories = res.items.filter(i => i.sourceId === s.id && i.id !== headline.id);
    if (stories.length) shelves.push({ sourceId: s.id, name: s.name, stories, stale: s.stale, when: s.stale ? (s.fetched ?? res.updated) : null });
  }
  const notes: Note[] = res.sources.filter(s => s.status === 'error').map(s => ({
    sourceId: s.id,
    text: `${s.name} did not load${s.error ? `: ${s.error}` : ''}.${s.stale ? ' Showing the stories it had before.' : ' Its stories are not shown.'}`,
  }));
  return { state: 'stories', headline, shelves, notes, updated: res.updated };
}

/** The notes to show when a refresh fails while stories are on screen: the old stories stay, and this note says they may be old. */
export function staleNotes(): Note[] {
  return [{ sourceId: '', text: STALE_TEXT }];
}

/** The key for one story: its feed and its id. Two feeds can carry the same story under the same id. */
export function storyKey(item: NewsItem): string {
  return `${item.sourceId}|${item.id}`;
}

/** Every story on the screen, by storyKey, for the reader sheet. */
export function storiesById(s: Extract<NewsScreen, { state: 'stories' }>): Map<string, NewsItem> {
  return new Map([s.headline, ...s.shelves.flatMap(x => x.stories)].map(i => [storyKey(i), i] as const));
}

/** The picture for a story: never while SHOW_IMAGES is off. The page then shows the letter block. */
export function pictureFor(item: NewsItem): string | null {
  return SHOW_IMAGES ? item.image : null;
}

/** What the reader sheet shows: the feed's own title and description, unchanged, and the link (or null). */
export function readerFor(item: NewsItem, now: number): { source: string; when: string; title: string; description: string; link: string | null } {
  return {
    source: item.source,
    when: ago(item.published, now),
    title: item.title,
    description: item.description || NO_SUMMARY_TEXT,
    link: linkFor(item),
  };
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
