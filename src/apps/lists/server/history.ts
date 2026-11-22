// What the family buys, counted: each time ticked items are cleared from a list, their names are counted here. An item
// bought at least twice is offered as a suggestion when it is not on the list. Kept in its own file (.lists-history.json),
// so the lists file itself keeps its format. CLAUDEOS_LISTS_HISTORY is for the tests only: a scratch file.
import path from 'node:path';
import { HUB, readJsonOrSetAside, writeJsonFile } from '../../../core/server/paths.ts';

export const HISTORY_FILE = process.env.CLAUDEOS_LISTS_HISTORY || path.join(HUB, '.lists-history.json');
const MAX_KEEP = 200;     // the most-used names kept
const MIN_COUNT = 2;      // bought this many times before it is suggested

interface Entry { n: number; at: string; text: string }
interface History { counts: Record<string, Entry> }

const keyOf = (text: string): string => text.trim().toLowerCase().slice(0, 80);

function load(): History {
  const h = readJsonOrSetAside<History>(HISTORY_FILE);
  return h && typeof h.counts === 'object' && h.counts ? h : { counts: {} };
}

const byUse = (a: [string, Entry], b: [string, Entry]): number => b[1].n - a[1].n || b[1].at.localeCompare(a[1].at);

/** Count items that were bought (ticked, then cleared). Keeps the MAX_KEEP most used. */
export function recordBought(texts: string[]): void {
  if (!texts.length) return;
  const h = load();
  const at = new Date().toISOString();
  for (const t of texts) {
    const k = keyOf(t);
    if (!k) continue;
    const e = h.counts[k];
    h.counts[k] = { n: (e?.n ?? 0) + 1, at, text: t.trim().slice(0, 80) };
  }
  h.counts = Object.fromEntries(Object.entries(h.counts).sort(byUse).slice(0, MAX_KEEP));
  try { writeJsonFile(HISTORY_FILE, h, { indent: 1 }); } catch (e) { console.log('lists: could not save the history:', e); }
}

/** Names bought at least twice that are not on the list now, most used first (as they were written). */
export function suggestions(onList: string[], n = 8): string[] {
  const have = new Set(onList.map(keyOf));
  return Object.entries(load().counts)
    .filter(([k, e]) => e.n >= MIN_COUNT && !have.has(k))
    .sort(byUse)
    .slice(0, n)
    .map(([, e]) => e.text);
}
