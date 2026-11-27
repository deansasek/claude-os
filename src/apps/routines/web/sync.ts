// The tablet's copy of the routines and the queue of changes the PC hasn't got yet (docs/specs/pc-hub-retirement.md,
// step 2). A change applies to the copy at once (web/local.ts) and waits in the queue. The queue goes to the PC in order
// whenever the PC answers; then the PC's routines (with Claude's edits) replace the copy. On the first run the copy is
// taken from the PC once; while the PC is off then, the page waits and nothing is copied. run.ts loads this module, so
// the queue is sent even when the Routines app is not open.
import { getJson, postJson, store } from '../../../core/web/dom.ts';
import { caps } from '../../../core/web/device.ts';
import { hubReachable, onHubReachable } from '../../../core/web/hub-link.ts';
import type { Routine, RoutinesResult } from '../api.ts';
import { applyOp, keepOps, keepRoutines, remapIds, type Op, type OpResult } from './local.ts';

const API = '/api/routines';
// a PC call that never answers gives up, so the queue and the pull do not wait behind it for good
const SYNC_TIMEOUT_MS = 20e3;
const COPY_KEY = 'routines.copy';     // the routines on this tablet
const QUEUE_KEY = 'routines.queue';   // changes the PC hasn't got yet, oldest first

function readArr<T>(key: string): T[] | null {
  try {
    const v = JSON.parse(store.get(key) || 'null') as unknown;
    return Array.isArray(v) ? v as T[] : null;
  } catch { return null; }
}

const storedCopy = caps.localState ? keepRoutines(readArr<unknown>(COPY_KEY)) : { routines: null, dropped: false };
let copy: Routine[] | null = storedCopy.routines;
const storedQueue = caps.localState ? keepOps(readArr<unknown>(QUEUE_KEY)) : { ops: [] as Op[], dropped: false };
let queue: Op[] = storedQueue.ops;
let pulledAt = 0;
const watchers = new Set<() => void>();

function keep(): void {
  store.set(COPY_KEY, copy ? JSON.stringify(copy) : null);
  store.set(QUEUE_KEY, queue.length ? JSON.stringify(queue) : null);
}

function changed(): void {
  keep();
  for (const f of watchers) f();
  dispatchEvent(new CustomEvent('hub:routines'));
}

/** Whether the tablet has its copy (after the first run). */
export const hasCopy = (): boolean => copy !== null;
/** The tablet's copy now, or null before the first copy from the PC. */
export const localRoutines = (): Routine[] | null => copy;
/** Milliseconds since the copy last matched the PC. */
export const copyAge = (): number => Date.now() - pulledAt;
/** Run f after the copy changes. */
export function onCopyChange(f: () => void): void { watchers.add(f); }

// One PC round at a time: a queue send and a pull never overlap.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn);
  chain = p.catch(() => undefined);
  return p;
}

/** Send the queued changes in order. Stops at the first one the PC could not take (the rest wait, in order). */
async function sendQueue(): Promise<void> {
  while (queue.length) {
    const op = queue[0];
    let r: RoutinesResult;
    try { r = await postJson<RoutinesResult>(`${API}/${op.path}`, op.body, SYNC_TIMEOUT_MS); } catch { return; }
    if (!r || (!r.ok && r.retry)) return;   // the PC is away or could not save its file: keep the queue
    queue.shift();                          // done, or refused (for example a scene Home no longer has): the PC's list shows it
    const sent = (op.body.routine as { id?: string } | undefined)?.id;
    if (r.ok && op.path === 'save' && r.id && sent && r.id !== sent) remapIds(queue, sent, r.id);
    keep();
  }
}

/** Take the PC's routines when the queue is empty. A first run copies them; a PC with no file gets the copy back. */
async function pullNow(): Promise<void> {
  if (!caps.localState || queue.length) return;
  let r: RoutinesResult;
  try {
    r = await getJson<RoutinesResult>(`${API}/list`, SYNC_TIMEOUT_MS);
    if (r?.ok && r.stored === false && copy) r = await postJson<RoutinesResult>(`${API}/restore`, { routines: copy }, SYNC_TIMEOUT_MS);
  } catch { return; }
  if (!r?.ok || !Array.isArray(r.routines) || queue.length) return;
  pulledAt = Date.now();
  if (JSON.stringify(r.routines) !== JSON.stringify(copy)) { copy = r.routines; changed(); }
}

/** Send the queue, then take the PC's routines. Waits while the PC is away (the queue stays). */
export const flush = (): Promise<void> => serial(async () => { await sendQueue(); await pullNow(); });
/** Take the PC's routines now (the queue goes first). */
export const pull = (): Promise<void> => serial(pullNow);

/** A change to the copy: the result at once, and the change waits in the queue. Null before the first copy (the caller
 *  then talks to the PC as before). */
export function apply(op: Op): OpResult | null {
  if (copy === null) return null;
  const r = applyOp(copy, op);
  if (r.ok) { copy = r.routines; queue.push(op); changed(); void flush(); }
  return r;
}

if (caps.localState) {
  if (storedQueue.dropped || storedCopy.dropped) keep();   // write back the queue and the copy without their bad entries
  void flush();                                            // a queue left from before, or the first copy
  onHubReachable(() => { if (hubReachable()) void flush(); });   // the PC is back: send what waited
}
