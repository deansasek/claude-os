// The News topics the owner switches on or off in Settings (#357). A topic is a feed in web/feeds.ts, named by its id.
// Every topic is on until the owner turns it off. Pure: used by the PC route (server/topics.ts) and the page (index.ts).
import type { NewsTopic } from '../api.ts';
import type { SettingRow } from '../../../core/web/app-settings.ts';
import type { Feed } from './feeds.ts';

export type TopicChoices = Record<string, boolean>;   // only the topics the owner has changed; the rest are on

/** True unless the owner turned the topic off. */
export const isOn = (choices: TopicChoices, id: string): boolean => choices[id] !== false;

/** The feeds whose topic is on, in list order. */
export const activeFeeds = (feeds: Feed[], choices: TopicChoices): Feed[] => feeds.filter(f => isOn(choices, f.id));

/** Every topic with its state, in list order. */
export const topicsFor = (feeds: Feed[], choices: TopicChoices): NewsTopic[] =>
  feeds.map(f => ({ id: f.id, name: f.name, on: isOn(choices, f.id) }));

/** Where the topic read stands: in flight, failed (no answer from the PC), or loaded. */
export type TopicsState = 'loading' | 'failed' | 'loaded';

/** The Settings rows for the topics. One switch per topic once loaded; until then, one info row. */
export function topicRows(feeds: Feed[], choices: TopicChoices, state: TopicsState,
  save: (id: string, on: boolean) => Promise<void>): SettingRow[] {
  if (state === 'loading') return [{ kind: 'info', id: 'topics-state', title: 'News topics', value: () => 'Loading…' }];
  if (state === 'failed') return [{ kind: 'info', id: 'topics-state', title: 'News topics',
    detail: 'Can’t reach the PC right now.', value: () => 'Couldn’t load' }];
  return feeds.map((f): SettingRow => ({
    kind: 'switch', id: `topic-${f.id}`, title: f.name, detail: 'Shows its shelf on News.',
    get: () => isOn(choices, f.id),
    set: v => save(f.id, v),
  }));
}

/** Keeps only the choices for known topics, with a true or false value each. Anything else is dropped. */
export function cleanChoices(raw: unknown, feeds: Feed[]): TopicChoices {
  const out: TopicChoices = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const f of feeds) {
    const v = (raw as Record<string, unknown>)[f.id];
    if (typeof v === 'boolean') out[f.id] = v;
  }
  return out;
}

/** The change a Settings switch sends. Refuses a topic name that is not in the feed list. */
export function parseChange(body: unknown, feeds: Feed[]): { ok: true; id: string; on: boolean } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.id !== 'string' || !feeds.some(f => f.id === b.id)) return { ok: false, error: 'unknown_topic' };
  if (typeof b.on !== 'boolean') return { ok: false, error: 'bad_value' };
  return { ok: true, id: b.id, on: b.on };
}

/** The message when a topic change is not saved. Null means no answer from the PC; ok: false means the PC answered and did not save. */
export const topicSaveError = (answer: { ok: boolean } | null): string =>
  answer === null ? 'Can’t reach your PC. Check it’s on, then try again.' : 'The PC couldn’t save that topic. Try again.';
