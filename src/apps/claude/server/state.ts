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

// Entries that could not be read (a non-string id, a pin value that is not a list). They are not used, but a save writes
// them back, so a change never deletes them. Only forgetState drops a session's unread pins, when the session is deleted.
interface Unread { archived: unknown[]; pins: Record<string, unknown> }
let unread: Unread = { archived: [], pins: {} };

function load(): State {
  const s = readJsonOrSetAside<Partial<State>>(FILE);
  const pins: Record<string, string[]> = {};
  const bad: Unread = { archived: [], pins: {} };
  if (s?.pins && typeof s.pins === 'object') {
    for (const [id, list] of Object.entries(s.pins)) {
      if (!Array.isArray(list)) { bad.pins[id] = list; continue; }
      pins[id] = list.filter(x => typeof x === 'string');
      const rest = list.filter(x => typeof x !== 'string');
      if (rest.length) bad.pins[id] = rest;
    }
  }
  const archived = Array.isArray(s?.archived) ? s.archived.filter(x => typeof x === 'string') : [];
  if (Array.isArray(s?.archived)) bad.archived = s.archived.filter(x => typeof x !== 'string');
  unread = bad;
  const n = bad.archived.length + Object.keys(bad.pins).length;
  if (n) console.log(`claude: ${n} saved entries could not be read and are kept in ${path.basename(FILE)}`);
  return { archived, pins };
}

let state: State = load();

/** Write the whole state, with the unread entries kept. The new state replaces the one in memory only when the write succeeds. */
function save(next: State, dropUnreadPins?: string): boolean {
  const pins: Record<string, unknown> = { ...next.pins };
  for (const [id, v] of Object.entries(unread.pins)) {
    if (id === dropUnreadPins) continue;
    if (Array.isArray(v)) pins[id] = [...(Array.isArray(pins[id]) ? pins[id] as string[] : []), ...v];
    else if (!(id in pins)) pins[id] = v;
  }
  const archived = [...next.archived, ...unread.archived];
  try {
    writeJsonFile(FILE, { archived, pins }, { indent: 2 });
  } catch (e) {
    console.log('claude: state save failed:', String((e as Error).message || e).slice(0, 160));
    return false;
  }
  state = next;
  if (dropUnreadPins) delete unread.pins[dropUnreadPins];
  return true;
}

export const archivedIds = (): Set<string> => new Set(state.archived);

export function setArchived(id: string, on: boolean): boolean {
  if (on === state.archived.includes(id)) return true;   // nothing changes: nothing to write
  const rest = state.archived.filter(x => x !== id);
  return save({ ...state, archived: on ? [...rest, id] : rest });
}

/** The messages pinned in a session (their ids from the log). */
export const pinnedIn = (id: string): string[] => state.pins[id] || [];

export function setPinned(id: string, message: string, on: boolean): boolean {
  // nothing changes (already pinned, or not pinned): nothing to write. A message already pinned keeps its place.
  if (on === (state.pins[id] || []).includes(message)) return true;
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
  return save({ archived: state.archived.filter(x => x !== id), pins }, id);
}
