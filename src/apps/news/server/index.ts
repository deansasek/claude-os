// News app routes (all under /api/news/):
//   GET feed    the stories from every topic that is on in web/feeds.ts, merged and sorted newest first (a NewsFeedResponse)
//   GET topics  every topic with its on or off state (a NewsTopicsResponse)
//   POST topics {id, on}: save one topic on or off. An unknown topic is refused: {ok: false, error: 'unknown_topic'}
import type { ServerApp } from '../../../core/server/app.ts';
import { manifest } from '../manifest.ts';
import { newsFeed } from './news.ts';
import { setTopic, topicsView } from './topics.ts';

const app: ServerApp = {
  id: manifest.id,
  routes: [
    { method: 'GET', path: 'feed', handle: () => newsFeed() },
    { method: 'GET', path: 'topics', handle: () => topicsView() },
    { method: 'POST', path: 'topics', handle: ({ body }) => setTopic(body) },
  ],
};
export default app;
