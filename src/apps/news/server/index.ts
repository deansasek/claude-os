// News app routes (all under /api/news/):
//   GET feed    the stories from every feed in feeds.ts, merged and sorted newest first (a NewsFeedResponse)
import type { ServerApp } from '../../../core/server/app.ts';
import { manifest } from '../manifest.ts';
import { newsFeed } from './news.ts';

const app: ServerApp = {
  id: manifest.id,
  routes: [
    { method: 'GET', path: 'feed', handle: () => newsFeed() },
  ],
};
export default app;
