// The tablet's own copy of the routines (docs/specs/pc-hub-retirement.md, step 2). Pure: no DOM, no fetch, no storage.
// A change applies here first (applyOp) and waits in a queue; web/sync.ts sends the queue to the PC in order when the PC
// answers, then takes the PC's routines, which also hold what Claude changed there meanwhile.
// The rules match the PC's (server/store.ts), which checks every change again. A scene that is not on Home is refused
// there, so the PC's list replaces the tablet's copy once the queue is sent.
import { MAX_ROUTINES, ROUTINE_ID, cleanRoutine, phraseKey, type Routine } from '../api.ts';
import type { HaResult } from '../../home-assistant/api.ts';

export type OpPath = 'save' | 'delete';
/** One change, as the route and body the PC takes (server/index.ts): save {routine}, delete {id}. */
export interface Op { path: OpPath; body: Record<string, unknown> }
export interface OpResult { ok: boolean; routines: Routine[]; error?: string }

/** The words a scene step says after the PC answers: '' when the scene is set, the PC's own reason when it refused, else a fallback. */
export function sceneStepWords(r: HaResult & { name?: string }): string {
  if (r.ok) return '';   // the lights changing say it
  if (r.error) return r.error;
  return `Couldn’t set the scene ${r.name || 'for this routine'}.`;
}

/** How many routines, from the top of the list, show as tiles on the Home screen. */
export const HOME_ROUTINES = 2;

/** A new routine's id, made on the tablet from its name; the PC keeps it when it is free (server/store.ts saveRoutine). */
export function newRoutineId(name: string): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20).replace(/-+$/, '');
  const stem = /^[a-z]/.test(slug) ? slug : 'routine';
  return `${stem}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Apply one change to a copy of the routines. Fills in the id of a new routine (op.body.routine.id), so the PC uses the same. */
export function applyOp(routines: Routine[], op: Op): OpResult {
  const next = JSON.parse(JSON.stringify(routines)) as Routine[];
  if (op.path === 'delete') {
    const i = next.findIndex(r => r.id === op.body.id);
    if (i >= 0) next.splice(i, 1);
    return { ok: true, routines: next };
  }
  const raw = (op.body.routine ?? {}) as Record<string, unknown>;
  const c = cleanRoutine(raw);
  if ('error' in c) return { ok: false, routines, error: c.error };
  const at = next.findIndex(r => r.id === raw.id);   // -1 for a new routine (no id, or one not saved yet)
  if (next.some((r, i) => i !== at && phraseKey(r.name) === phraseKey(c.name))) {
    return { ok: false, routines, error: `There’s already a routine called ${c.name}.` };
  }
  for (const p of c.phrases) {
    const other = next.find((r, i) => i !== at && r.phrases.some(q => phraseKey(q) === phraseKey(p)));
    if (other) return { ok: false, routines, error: `“${p}” already runs ${other.name}.` };
  }
  if (at < 0 && next.length >= MAX_ROUTINES) return { ok: false, routines, error: `There are already ${MAX_ROUTINES} routines. Delete one first.` };
  const id = at >= 0 ? String(raw.id) : typeof raw.id === 'string' && ROUTINE_ID.test(raw.id) ? raw.id : newRoutineId(c.name);
  const saved: Routine = { id, ...c };
  if (at >= 0) next[at] = saved; else next.push(saved);
  raw.id = id;
  return { ok: true, routines: next };
}

/** The stored queue, with only the entries that are changes (a save or delete with an object body). A null or a half-written entry is dropped, so one bad value cannot stop the queue. */
export function keepOps(stored: unknown): { ops: Op[]; dropped: boolean } {
  const all: unknown[] = Array.isArray(stored) ? stored : [];
  const ops = all.filter((v): v is Op => typeof v === 'object' && v !== null && ((v as Op).path === 'save' || (v as Op).path === 'delete') && typeof (v as Op).body === 'object' && (v as Op).body !== null);
  return { ops, dropped: ops.length !== all.length };
}

/** The PC gave a routine another id than the tablet's: later queued changes use the PC's id. */
export function remapIds(queue: Op[], from: string, to: string): void {
  for (const op of queue) {
    if (op.body.id === from) op.body.id = to;
    const r = op.body.routine as Record<string, unknown> | undefined;
    if (r && r.id === from) r.id = to;
  }
}
