// The lists for every reader outside the Lists app. On the tablet the readers use the tablet's copy (local.ts COPY_KEY),
// so they work with the PC off; the PC's GET lists is the fallback before the copy exists (the first run) and on the
// Nest Hub, which has no copy. A read that cannot reach the PC throws, and the caller says so as before.
import { getJson, store } from '../../../core/web/dom.ts';
import { onTablet } from '../../../core/web/device.ts';
import type { FamilyList, ListsResult } from '../api.ts';
import { COPY_KEY } from './local.ts';
import { pickLists } from './read.ts';

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
