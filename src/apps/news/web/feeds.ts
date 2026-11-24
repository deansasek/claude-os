// The News feeds: keyless public RSS. Edit only this list. The feed terms are still to be confirmed (issue #357).
// The tablet reads these with its native fetch (NewsFetch.java, which allows only the hosts named here); the PC route reads them too.
import type { FeedSource } from './rss.ts';

export interface Feed extends FeedSource { url: string }

export const FEEDS: Feed[] = [
  { id: 'bbc', name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { id: 'npr', name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
];
