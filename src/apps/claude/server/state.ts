// The Claude app's own small state on this PC: which sessions are archived, and the messages pinned in each.
// Kept in claude-state.json (next to hub-sessions.json) and written whole whenever it changes.
import fs from 'node:fs';
import path from 'node:path';
import { STATE, readJson, writeJsonFile } from '../../../core/server/paths.ts';

const FILE = path.join(STATE, 'claude-state.json');

interface State {
  archived: string[];                    // session ids hidden from the list (nothing is deleted)
  pins: Record<string, string[]>;        // session id → pinned message ids
}

function load(): State {
  const s = readJson<Partial<State>>(FILE);
  const pins: Record<string, string[]> = {};
  if (s?.pins && typeof s.pins === 'object') {
    for (const [id, list] of Object.entries(s.pins)) if (Array.isArray(list)) pins[id] = list.filter(x => typeof x === 'string');
  }
  return { archived: Array.isArray(s?.archived) ? s.archived.filter(x => typeof x === 'string') : [], pins };
}

let state: State = load();
const save = (): void => writeJsonFile(FILE, state, { indent: 2 });

export const archivedIds = (): Set<string> => new Set(state.archived);

export function setArchived(id: string, on: boolean): void {
  const rest = state.archived.filter(x => x !== id);
  state.archived = on ? [...rest, id] : rest;
  save();
}

/** The messages pinned in a session (their ids from the log). */
export const pinnedIn = (id: string): string[] => state.pins[id] || [];

export function setPinned(id: string, message: string, on: boolean): void {
  const rest = (state.pins[id] || []).filter(x => x !== message);
  const next = on ? [...rest, message].slice(-200) : rest;
  if (next.length) state.pins[id] = next; else delete state.pins[id];
  save();
}

/** Forget everything kept for a session (after it is deleted). */
export function forgetState(id: string): void {
  state.archived = state.archived.filter(x => x !== id);
  delete state.pins[id];
  save();
}
