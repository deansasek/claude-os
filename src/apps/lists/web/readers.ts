// The lists for every reader outside the Lists app, and the writes that come from outside it. On the tablet the readers use
// the tablet's copy (local.ts COPY_KEY), so they work with the PC off; the PC's GET lists is the fallback before the copy
// exists (the first run) and on the Nest Hub, which has no copy. A read that cannot reach the PC throws, and the caller
// says so as before. A write (writeList) goes to the PC first, as before; the copy takes it in at once (read.ts afterWrite).
import { getJson, postJson, store } from '../../../core/web/dom.ts';
import { caps } from '../../../core/web/device.ts';
import type { FamilyList, ListsResult } from '../api.ts';
import { COPY_KEY, type Op, type OpPath } from './local.ts';
import { appendOp } from './queue.ts';
import { afterWrite, pickLists } from './read.ts';

function tabletCopy(): FamilyList[] | null {
  if (!caps.localState) return null;
  try {
    const v = JSON.parse(store.get(COPY_KEY) || 'null') as unknown;
    return Array.isArray(v) ? v as FamilyList[] : null;
  } catch { return null; }
}

/** All the lists, as a reader sees them now. */
export const readLists = (timeoutMs?: number): Promise<FamilyList[]> =>
  pickLists(tabletCopy(), () => getJson<ListsResult>('/api/lists/lists', timeoutMs));

/** True when a write threw because the PC could not take it and the tablet queued it (writeList). The caller says the
 *  change will be added when the PC is back. A write with no tablet copy (the Nest Hub) is never queued: no flag. */
export const isQueued = (e: unknown): boolean => (e as { queued?: boolean } | null)?.queued === true;

// a PC write that never answers gives up, so the change is queued (when the tablet has a copy) and the caller is not left waiting
const WRITE_TIMEOUT_MS = 20e3;

/** One change to the PC (the same route the Lists page uses), then the tablet's copy. When the PC cannot take it, the
 *  change waits in the queue the Lists page sends (once the tablet has a copy). Throws when the PC cannot be reached,
 *  as postJson does, so the caller's message stays the same; a queued change throws with queued: true (isQueued). */
export async function writeList(path: OpPath, body: Record<string, unknown>): Promise<ListsResult> {
  const op: Op = { path, body: { ...body } };
  let r: ListsResult | null = null;
  let err: unknown = null;
  let queued = false;
  try { r = await postJson<ListsResult>(`/api/lists/${path}`, body, WRITE_TIMEOUT_MS); } catch (e) { err = e; }
  const copy = tabletCopy();
  if (copy) {
    const next = afterWrite(copy, op, r);
    if (next.lists !== copy) store.set(COPY_KEY, JSON.stringify(next.lists));
    if (next.queue) { appendOp({ path, body }); queued = true; }
  }
  if (err) {
    if (queued) throw Object.assign(err instanceof Error ? err : new Error(String(err)), { queued: true });
    throw err;
  }
  return r as ListsResult;
}
