// The lists for every reader outside the Lists app, and the writes that come from outside it. On the tablet the readers use
// the tablet's copy (local.ts COPY_KEY), so they work with the PC off; the PC's GET lists is the fallback before the copy
// exists (the first run) and on the Nest Hub, which has no copy. A read that cannot reach the PC throws, and the caller
// says so as before. A write (writeList) goes to the PC first, as before; the copy takes it in at once (read.ts afterWrite).
import { getJson, postJson, store } from '../../../core/web/dom.ts';
import { onTablet } from '../../../core/web/device.ts';
import type { FamilyList, ListsResult } from '../api.ts';
import { COPY_KEY, QUEUE_KEY, type Op, type OpPath } from './local.ts';
import { afterWrite, pickLists } from './read.ts';

function tabletCopy(): FamilyList[] | null {
  if (!onTablet) return null;
  try {
    const v = JSON.parse(store.get(COPY_KEY) || 'null') as unknown;
    return Array.isArray(v) ? v as FamilyList[] : null;
  } catch { return null; }
}

/** All the lists, as a reader sees them now. */
export const readLists = (): Promise<FamilyList[]> =>
  pickLists(tabletCopy(), () => getJson<ListsResult>('/api/lists/lists'));

/** One change to the PC (the same route the Lists page uses), then the tablet's copy. When the PC cannot take it, the
 *  change waits in the queue the Lists page sends (once the tablet has a copy). Throws when the PC cannot be reached,
 *  as postJson does, so the caller's message stays the same. */
export async function writeList(path: OpPath, body: Record<string, unknown>): Promise<ListsResult> {
  const op: Op = { path, body: { ...body } };
  let r: ListsResult | null = null;
  let err: unknown = null;
  try { r = await postJson<ListsResult>(`/api/lists/${path}`, body); } catch (e) { err = e; }
  const copy = tabletCopy();
  if (copy) {
    const next = afterWrite(copy, op, r);
    if (next.lists !== copy) store.set(COPY_KEY, JSON.stringify(next.lists));
    if (next.queue) {
      let q: Op[] = [];
      try { q = JSON.parse(store.get(QUEUE_KEY) || '[]') as Op[]; } catch { q = []; }
      store.set(QUEUE_KEY, JSON.stringify([...q, { path, body }]));
    }
  }
  if (err) throw err;
  return r as ListsResult;
}
