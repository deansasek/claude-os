// The News topics the owner switched off, kept on this PC in news-topics.json (git-ignored). Only the changed topics are
// saved; a topic left out is on. A test sets CLAUDEOS_NEWS_TOPICS_FILE so the real file is never touched.
import path from 'node:path';
import { STATE, readJsonOrSetAside, writeJsonFile } from '../../../core/server/paths.ts';
import { FEEDS, type Feed } from '../web/feeds.ts';
import { cleanChoices, isOn, parseChange, topicsFor, type TopicChoices } from '../web/topics.ts';

const FILE = process.env.CLAUDEOS_NEWS_TOPICS_FILE || path.join(STATE, 'news-topics.json');

/** The saved choices. A missing or unreadable file means every topic is on. */
export function topicChoices(feeds: Feed[] = FEEDS, file: string = FILE): TopicChoices {
  return cleanChoices(readJsonOrSetAside<unknown>(file), feeds);
}

/** Every topic with its state, for the Settings rows and the page. */
export function topicsView(feeds: Feed[] = FEEDS, file: string = FILE) {
  return { topics: topicsFor(feeds, topicChoices(feeds, file)) };
}

/** Save one topic on or off. An unknown topic or a bad value is refused and nothing is written. A topic already in that state writes nothing. */
export function setTopic(body: unknown, feeds: Feed[] = FEEDS, file: string = FILE): { ok: true; topics: ReturnType<typeof topicsFor> } | { ok: false; error: string } {
  const c = parseChange(body, feeds);
  if (!c.ok) return c;
  const choices = topicChoices(feeds, file);
  if (isOn(choices, c.id) === c.on) return { ok: true, topics: topicsFor(feeds, choices) };
  choices[c.id] = c.on;
  writeJsonFile(file, choices, { indent: 2 });
  return { ok: true, topics: topicsFor(feeds, choices) };
}
