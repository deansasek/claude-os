// The rules for the lists outside the Lists app (docs/specs/pc-hub-retirement.md, step 4). Pure: no DOM, no fetch, no storage.
// Reads: the voice commands, the Home tiles, the Apps search and the routine steps call readLists (web/readers.ts), which
// passes the tablet's copy and the PC's read to pickLists. Writes: a voice change goes to the PC and then to the copy
// through afterWrite. Tests: test/lists-read.test.ts and test/lists-after-write.test.ts.
import { applyOp, type Op } from './local.ts';
import type { FamilyList, ListsResult } from '../api.ts';

/** The copy when the tablet has one; otherwise the PC's lists. A PC answer without lists reads as none.
 *  A PC answer with ok: false (the PC could not read its file) throws, so the caller can say so instead of showing empty lists. */
export async function pickLists(copy: FamilyList[] | null, fromPc: () => Promise<ListsResult>): Promise<FamilyList[]> {
  if (copy) return copy;
  const r = await fromPc();
  if (r?.ok === false) throw new Error(r.error ?? 'The PC couldn’t read its lists.');
  return Array.isArray(r?.lists) ? r.lists : [];
}

/** What one change does to the tablet's copy, given the PC's answer (null: the PC could not be reached).
 *  A change the PC took is applied to the copy with the Lists page's rule (applyOp); if that fails, the PC's lists are
 *  taken. A change the PC could not save (retry) or did not get is queued for the Lists page to send. A refused change
 *  changes nothing. */
export function afterWrite(copy: FamilyList[], op: Op, r: ListsResult | null): { lists: FamilyList[]; queue: boolean } {
  if (!r) return { lists: copy, queue: true };
  if (!r.ok) return { lists: copy, queue: r.retry === true };
  if (op.path === 'add' && r.item) op.body.id = r.item.id;   // the copy takes the PC's id
  const applied = applyOp(copy, op);
  return { lists: applied.ok ? applied.lists : r.lists, queue: false };
}
