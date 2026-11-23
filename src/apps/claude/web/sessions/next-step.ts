// The next-step choices Claude offers at the end of a turn (its mcp__ccd_turn__wrap_up call), as the desktop
// app shows them. The server reads them from the log; the quick replies show them. Pure, so Node tests load it.
import type { NextStep } from '../../api.ts';

export const WRAP_UP_TOOL = 'mcp__ccd_turn__wrap_up';

/** App actions the desktop app draws as buttons: [label, what gets sent from the tablet]. */
const ACTIONS: Record<string, [string, string]> = {
  commit: ['Commit', 'Commit the changes.'],
  create_pr: ['Create PR', 'Open a pull request for this.'],
  merge: ['Merge', 'Merge it.'],
  fix_ci: ['Fix CI', 'Fix the failing checks.'],
  address_comments: ['Address comments', 'Address the review comments.'],
  resolve_conflicts: ['Resolve conflicts', 'Resolve the merge conflicts.'],
  verify: ['Verify', 'Verify it.'],
  archive: ['Archive', 'Archive this session.'],
  new_session: ['New session', 'Start that as a new session.'],
};

/** An app action as [label, reply]. An unknown action reads as its words: "run_tests" -> ["Run tests", "Run tests."]. */
export function actionChoice(action: string): [string, string] {
  const known = ACTIONS[action];
  if (known) return known;
  const words = action.replace(/[_-]+/g, ' ').trim();
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  return [label, `${label}.`];
}

/** The choices in one wrap_up call's input, or null when it offers no buttons. */
export function wrapUpChoices(input: any): NextStep | null {
  const actions: any[] = Array.isArray(input?.actions) ? input.actions : [];
  const choices: [string, string][] = [];
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;
    if (typeof a.action === 'string' && a.action.trim()) choices.push(actionChoice(a.action.trim()));
    else if (typeof a.label === 'string' && a.label.trim()) choices.push([a.label.trim(), a.label.trim()]);
  }
  if (!choices.length) return null;
  const ask = typeof input?.ask === 'string' && input.ask.trim() ? input.ask.trim() : null;
  return { ask, choices };
}

/** One step of a transcript as far as the choices care: a user message, or a wrap_up call with its input. */
export type ChoiceEvent = { kind: 'user' } | { kind: 'wrap_up'; input: any };

/**
 * The latest wrap_up's choices, only when no user message came after that call (older choices are stale).
 * A later wrap_up with no buttons also clears them, as the desktop app then shows no buttons.
 */
export function currentChoices(events: ChoiceEvent[]): NextStep | null {
  const e = events[events.length - 1];
  return !e || e.kind === 'user' ? null : wrapUpChoices(e.input);
}
