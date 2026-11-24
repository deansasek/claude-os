// Shapes of the News app's server answers. Imported by both sides.

// One story from a feed. Dates are ISO strings in UTC; null when the feed gives no valid date.
export interface NewsItem {
  id: string;            // the link, or the title when the item has no link
  title: string;
  link: string | null;
  published: string | null;
  description: string;   // the feed's summary as plain text (tags and entities removed), never cut
  image: string | null;  // an http(s) image URL, when the feed gives one
  source: string;        // the feed's name, e.g. "BBC News"
  sourceId: string;      // the feed's id, e.g. "bbc"
}

export interface NewsSourceStatus {
  id: string;
  name: string;
  status: 'ok' | 'error';
  stale: boolean;        // true when the stories come from an earlier good fetch
  error?: string;        // a short reason, e.g. "timed out" or "HTTP 503"
}

export interface NewsFeedResponse {
  // ok: every feed answered. partial: some feeds failed. error: every feed failed and no stories are cached.
  status: 'ok' | 'partial' | 'error';
  items: NewsItem[];     // all feeds merged, newest first
  sources: NewsSourceStatus[];
  updated: string | null; // when the newest feed data was fetched
}
