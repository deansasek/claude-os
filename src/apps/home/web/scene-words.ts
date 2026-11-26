// The words Home's scene button says when a scene fails (src/apps/home/web/index.ts setScene). Pure: no DOM, so it runs in node
// (test/home-scene-fail.test.ts). The reason comes from the same plain-words rule the Home Assistant app uses.
import { plain } from '../../home-assistant/api.ts';

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
