// Saved Browser lists (tabs, history, bookmarks, downloads, quick links), read from the store. A value that is not an
// array gives null (the caller uses its default), and an entry that fails its check is left out. Pure: no DOM, no store.

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** An entry with a string url (history, bookmarks, quick links). */
export const hasUrl = (v: unknown): boolean => isObj(v) && typeof v.url === 'string';
/** A history visit: a string url and title, and a numeric time. A visit with any other shape is left out. */
export const isVisit = (v: unknown): boolean => hasUrl(v) && isObj(v) && typeof v.title === 'string' && typeof v.at === 'number' && Number.isFinite(v.at);
/** An entry with a string id (tabs). */
export const hasStringId = (v: unknown): boolean => isObj(v) && typeof v.id === 'string';
/** An entry with a numeric id (downloads). */
export const hasNumberId = (v: unknown): boolean => isObj(v) && typeof v.id === 'number' && Number.isFinite(v.id);

/** The saved list, with the entries that pass `ok`; null when the saved value is not an array. */
export function readSavedList<T>(raw: string | null, ok: (v: unknown) => boolean): T[] | null {
  let v: unknown;
  try { v = JSON.parse(raw || 'null'); } catch { return null; }
  return Array.isArray(v) ? (v.filter(ok) as T[]) : null;
}

/** The saved permissions: a plain object, or null when the value is anything else. */
export function readSavedObject<T>(raw: string | null): T | null {
  let v: unknown;
  try { v = JSON.parse(raw || 'null'); } catch { return null; }
  return isObj(v) ? (v as T) : null;
}
