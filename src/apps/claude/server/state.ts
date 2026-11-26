// The Claude app's own small state on this PC: which sessions are archived, and the messages pinned in each.
// Kept in claude-state.json (next to hub-sessions.json) and written whole whenever it changes.
// A damaged file is kept as claude-state.json.corrupt and is never saved over. A save that fails leaves memory as it was.
import path from 'node:path';
import { STATE, readJsonOrSetAside, writeJsonFile } from '../../../core/server/paths.ts';

// CLAUDEOS_CLAUDE_STATE_FILE is for the tests only: a scratch file instead of the real one.
export const FILE = process.env.CLAUDEOS_CLAUDE_STATE_FILE || path.join(STATE, 'claude-state.json');

interface State {
  archived: string[];                    // session ids hidden from the list (nothing is deleted)
  pins: Record<string, string[]>;        // session id → pinned message ids
}

function load(): State {
  const s = readJsonOrSetAside<Partial<State>>(FILE);
  const pins: Record<string, string[]> = {};
  if (s?.pins && typeof s.pins === 'object') {
    for (const [id, list] of Object.entries(s.pins)) if (Array.isArray(list)) pins[id] = list.filter(x => typeof x === 'string');
  }
  return { archived: Array.isArray(s?.archived) ? s.archived.filter(x => typeof x === 'string') : [], pins };
}

let state: State = load();

/** Write the whole state. The new state replaces the one in memory only when the write succeeds. */
function save(next: State): boolean {
  try {
    writeJsonFile(FILE, next, { indent: 2 });
  } catch (e) {
    console.log('claude: state save failed:', String((e as Error).message || e).slice(0, 160));
    return false;
  }
  state = next;
  return true;
}

export const archivedIds = (): Set<string> => new Set(state.archived);

export function setArchived(id: string, on: boolean): boolean {
  const rest = state.archived.filter(x => x !== id);
  return save({ ...state, archived: on ? [...rest, id] : rest });
}

/** The messages pinned in a session (their ids from the log). */
export const pinnedIn = (id: string): string[] => state.pins[id] || [];

export function setPinned(id: string, message: string, on: boolean): boolean {
  const rest = (state.pins[id] || []).filter(x => x !== message);
  const next = on ? [...rest, message].slice(-200) : rest;
  const pins = { ...state.pins };
  if (next.length) pins[id] = next; else delete pins[id];
  return save({ ...state, pins });
}

/** Forget everything kept for a session (after it is deleted). */
export function forgetState(id: string): boolean {
  const pins = { ...state.pins };
  delete pins[id];
  return save({ archived: state.archived.filter(x => x !== id), pins });
}
