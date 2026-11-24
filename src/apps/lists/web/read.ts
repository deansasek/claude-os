// The rule for reading the lists (docs/specs/pc-hub-retirement.md, step 4). Pure: no DOM, no fetch, no storage.
// The voice commands, the Home tiles, the Apps search and the routine steps call readLists (web/readers.ts), which
// passes the tablet's copy and the PC's read here. Test: test/lists-read.test.ts.
import type { FamilyList, ListsResult } from '../api.ts';

/** The copy when the tablet has one; otherwise the PC's lists. A PC answer without lists reads as none. */
export async function pickLists(copy: FamilyList[] | null, fromPc: () => Promise<ListsResult>): Promise<FamilyList[]> {
  if (copy) return copy;
  const r = await fromPc();
  return Array.isArray(r?.lists) ? r.lists : [];
}
