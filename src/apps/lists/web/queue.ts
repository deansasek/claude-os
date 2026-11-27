// The one writer of lists.queue: the changes the PC does not have yet, oldest first. The Lists page (index.ts) and the
// voice writes (readers.ts writeList) both go through these functions, each reading the stored queue first, so a change
// queued by one is never lost to a write by the other. The rules are pure (local.ts queueAppend, queueRemove, queueRemap).
import { store } from '../../../core/web/dom.ts';
import { QUEUE_KEY, keepOps, queueAppend, queueRemap, queueRemove, newQueueKey, type Op } from './local.ts';

export function readQueue(): Op[] {
  let stored: unknown;
  try { stored = JSON.parse(store.get(QUEUE_KEY) || '[]'); } catch { stored = []; }
  let { ops, dropped } = keepOps(stored);
  const keyless = ops.some(op => !op.key);
  if (keyless) ops = ops.map(op => (op.key ? op : { ...op, key: newQueueKey() }));
  if (dropped || keyless) writeQueue(ops);
  return ops;
}

function writeQueue(q: Op[]): void {
  store.set(QUEUE_KEY, q.length ? JSON.stringify(q) : null);
}

/** Add one change at the end (a voice write, or the Lists page after a change it applied). */
export function appendOp(op: Op): void { writeQueue(queueAppend(readQueue(), op)); }

/** Remove the entry the flush sent. Entries added meanwhile stay. */
export function removeOp(key: string): void { writeQueue(queueRemove(readQueue(), key)); }

/** The PC gave an id (or list id) other than the tablet's: later entries use the PC's. */
export function remapQueue(key: 'id' | 'list', from: unknown, to: string): void { writeQueue(queueRemap(readQueue(), key, from, to)); }
