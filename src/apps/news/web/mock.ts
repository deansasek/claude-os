// News in the mock page (no hub): sample stories and three topics, so the app shows stories with the hub stopped.
// The shapes are the ones in ../api.ts. The stories are made up.
import { defineMock } from '../../../core/web/mock-api.ts';
import type { NewsFeedResponse, NewsTopic, NewsTopicsResponse } from '../api.ts';

const updated = '2026-11-25T09:00:00Z';
const story = (n: number, source: string, sourceId: string): NewsFeedResponse['items'][number] => ({
  id: `https://example.test/${sourceId}/${n}`,
  title: `Sample headline ${n} from ${source}`,
  link: `https://example.test/${sourceId}/${n}`,
  published: `2026-11-25T0${8 - n}:30:00Z`,
  description: 'A made-up story for the mock page. Nothing here is real news.',
  image: null,
  source,
  sourceId,
});

const topics: NewsTopic[] = [
  { id: 'bbc', name: 'BBC News', on: true },
  { id: 'npr', name: 'NPR', on: true },
  { id: 'bbc-technology', name: 'BBC Technology', on: false },
];

const feed: NewsFeedResponse = {
  status: 'ok',
  items: [story(1, 'BBC News', 'bbc'), story(2, 'NPR', 'npr'), story(3, 'BBC News', 'bbc')],
  sources: topics.filter(t => t.on).map(t => ({ id: t.id, name: t.name, status: 'ok', stale: false })),
  updated,
};

defineMock({
  'GET /api/news/feed': (): NewsFeedResponse => feed,
  'GET /api/news/topics': (): NewsTopicsResponse => ({ topics }),
  'POST /api/news/topics': ({ body }) => {
    const b = body as { id?: unknown; on?: unknown } | null;
    const t = topics.find(x => x.id === b?.id);
    if (!t) return { ok: false, error: 'unknown_topic' };
    t.on = b?.on === true;   // the mock keeps the change for the session, as the PC would
    return { ok: true, topics };
  },
});
