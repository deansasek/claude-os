// Photos app API (all under /api/photos/):
//   POST upload          raw JPEG body (max 8 MB), header X-Photo-Id: <id>   → {ok, id, url}
//   GET  list?limit=     photos, newest first, grouped by day (hasThumb: the PC has a thumbnail for it) → {ok, days}
//   GET  file?id=        the JPEG itself
//   GET  file?id=&size=thumb   the photo's thumbnail if the PC has one, otherwise the JPEG itself
//   POST thumb?id=       raw JPEG body (max THUMB_MAX_BYTES) for a photo the PC has → {ok, id}
//   POST delete {id} or {ids}  → {ok, deleted, missing, failed}  (missing: already gone; failed: could not be removed)
/** The most photos one message to Claude carries (the server's MAX_PER_ASK in server/store.ts). */
export const ASK_MAX_PHOTOS = 3;
/** A thumbnail's longest side in px, and the most bytes one may be (the PC refuses more). */
export const THUMB_PX = 400;
export const THUMB_MAX_BYTES = 200 * 1024;
/** Where a photo's thumbnail is shown from. A photo with no thumbnail yet gets the full picture from the same address. */
export const thumbUrl = (id: string): string => `/api/photos/file?id=${encodeURIComponent(id)}&size=thumb`;
export interface PhotoItem { id: string; at: string; url: string; hasThumb: boolean }
export interface PhotoDay { day: string; photos: PhotoItem[] }
export interface PhotoList { ok: boolean; days: PhotoDay[]; more?: boolean; error?: string }   // more: photos past the list's limit; error: the PC could not read its folder
/** The photo days to show after a list read: the new days when the PC read its folder, else the days already shown (a failed read keeps the grid). */
export function nextPhotoDays(prev: PhotoDay[], list: { ok?: boolean; days?: unknown }): PhotoDay[] {
  return list.ok !== false && Array.isArray(list.days) ? (list.days as PhotoDay[]) : prev;
}

export interface UploadResult { ok: boolean; id?: string; url?: string; error?: string }
export interface PhotoDeleteResult { ok: boolean; error?: string; deleted?: string[]; missing?: string[]; failed?: string[] }
/** Pick every id in a day's group, or clear them when they are all picked already. Other picks stay. */
export function toggleDay(picked: Set<string>, ids: string[]): Set<string> {
  const out = new Set(picked);
  const all = ids.length > 0 && ids.every(id => picked.has(id));
  for (const id of ids) { if (all) out.delete(id); else out.add(id); }
  return out;
}

/** The photo the viewer moves to when the shown one is deleted: the next surviving one in the grid order, else the one before it, else null. */
export function afterDelete(orderIds: string[], shownId: string, gone: Set<string>): string | null {
  const at = orderIds.indexOf(shownId);
  if (at < 0) return null;
  for (let i = at + 1; i < orderIds.length; i++) if (!gone.has(orderIds[i])) return orderIds[i];
  for (let i = at - 1; i >= 0; i--) if (!gone.has(orderIds[i])) return orderIds[i];
  return null;
}

/** The most ids one delete request carries. The PC refuses more (server/store.ts MAX_PER_DELETE: keep them equal). */
export const DELETE_BATCH = 200;
/** The ids split into delete requests of at most DELETE_BATCH, in the same order. */
export function deleteBatches(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += DELETE_BATCH) out.push(ids.slice(i, i + DELETE_BATCH));
  return out;
}
