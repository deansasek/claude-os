// The News feeds: keyless public RSS. Edit only this list. Each feed is one topic the owner can switch on or off in Settings (#357).
// The tablet reads these with its native fetch (NewsFetch.java, which allows only the hosts named there); the PC route reads them too.
import type { FeedSource } from './rss.ts';

export interface Feed extends FeedSource { url: string }

export const FEEDS: Feed[] = [
  { id: 'bbc', name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { id: 'npr', name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  { id: 'bbc-technology', name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { id: 'bbc-science', name: 'BBC Science and Environment', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml' },
  { id: 'bbc-world', name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
];
