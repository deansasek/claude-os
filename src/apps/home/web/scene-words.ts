// The words Home's scene button says when a scene fails (src/apps/home/web/index.ts setScene). Pure: no DOM, so it runs in node
// (test/home-scene-fail.test.ts). The reason comes from the same plain-words rule the Home Assistant app uses.
import { plain, type HaScenes } from '../../home-assistant/api.ts';

/** True when the PC refused the scene because it is not on Home any more (the rule the PC checks). */
export function isOffHome(r: { error?: string } | null): boolean {
  return !!r?.error && /on Home/i.test(r.error);
}

/** The sentence for a scene that did not set. r is null when the PC gave no answer. */
export function sceneFailText(name: string, r: { error?: string } | null): string {
  if (!r) return `The PC isn’t answering, so ${name} didn’t change.`;
  if (isOffHome(r)) return `${name} isn’t on Home any more.`;
  return `Couldn’t set ${name}. ${plain(r.error)}`;
}

// The Home screen's scene buttons after a read of GET /api/home-assistant/scenes (loadScenes in index.ts).
// ok: the picks, in order, that the scene list still holds (at most three). not_set_up: no buttons.
// error, or any other answer: keep the buttons already shown, so a PC that cannot reach Home Assistant does not clear them.
export interface SceneAct { id: string; name: string }

export function sceneActsAfterRead(prev: SceneAct[], r: HaScenes | null | undefined): SceneAct[] {
  if (r?.status === 'not_set_up') return [];
  if (r?.status !== 'ok') return prev;
  return r.home
    .map(id => r.scenes.find(s => s.entity_id === id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map(s => ({ id: s.entity_id, name: s.name }))
    .slice(0, 3);
}
