// Photos on the PC: photos/YYYY-MM-DD/<id>.jpg under the repository root, and nothing else is ever written there.
// Ids are short safe tokens made by the tablet (or the mock); anything else is refused, so a
// name can never reach outside its day folder.
import fs from 'node:fs';
import path from 'node:path';
import { STATE } from '../../../core/server/paths.ts';
import { THUMB_MAX_BYTES } from '../api.ts';

export const PHOTOS = path.join(STATE, 'photos');
export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_PER_ASK = 3;          // photos sent with one message to Claude
export const MAX_PER_DELETE = 200;     // photos removed with one request (the select mode's Delete)

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** An id is a photo's own name. An id ending in _thumb is another photo's thumbnail file, so it is refused. */
export const safeId = (v: unknown): string | null => (typeof v === 'string' && ID.test(v) && !/_thumb$/.test(v) ? v : null);

/** A list of photo ids from a request, or null if it isn't one. */
export function photoIdsFrom(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  const ids = v.map(safeId);
  return ids.every(Boolean) ? ids as string[] : null;
}

export const isJpeg = (b: Buffer): boolean => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

const dayName = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A folder that is not there (ENOENT). */
const missing = (e: unknown): boolean => (e as NodeJS.ErrnoException).code === 'ENOENT';

/** Where a photo is, if it exists: the file's full path and its day. Throws when the folder cannot be read (not ENOENT), so a failed read is never taken for a photo that is gone. */
function locate(id: string): { file: string; day: string } | null {
  if (!safeId(id)) return null;
  let days: string[];
  try { days = fs.readdirSync(PHOTOS).filter(d => DAY.test(d)); }
  catch (e) { if (missing(e)) return null; throw e; }
  for (const day of days.sort().reverse()) {
    const file = path.join(PHOTOS, day, `${id}.jpg`);
    if (fs.existsSync(file)) return { file, day };
  }
  return null;
}

/** Save a JPEG under today's day folder. Returns the day, or an error. */
export function savePhoto(id: string, data: Buffer): { ok: true; day: string } | { ok: false; error: string } {
  if (!safeId(id)) return { ok: false, error: 'bad_id' };
  if (data.length === 0 || data.length > MAX_BYTES) return { ok: false, error: 'too_big' };
  if (!isJpeg(data)) return { ok: false, error: 'not_jpeg' };
  let existing: unknown;
  try { existing = locate(id); } catch { return { ok: false, error: 'read_failed' }; }
  if (existing) return { ok: false, error: 'exists' };
  const day = dayName(new Date());
  // written to a .part file first, then renamed: a failed write never leaves a truncated photo in the list
  const file = path.join(PHOTOS, day, `${id}.jpg`), part = `${file}.part`;
  try {
    fs.mkdirSync(path.join(PHOTOS, day), { recursive: true });
    fs.writeFileSync(part, data, { flag: 'wx' });
    fs.renameSync(part, file);
  } catch (e) {
    console.log('photos: could not save a photo:', (e as NodeJS.ErrnoException).code ?? 'error');
    try { fs.rmSync(part, { force: true }); } catch { /* nothing more to do */ }
    return { ok: false, error: 'write_failed' };
  }
  return { ok: true, day };
}

/** A photo's thumbnail, beside it in its day folder: <id>_thumb.jpg. */
const thumbFile = (id: string, day: string): string => path.join(PHOTOS, day, `${id}_thumb.jpg`);

/** The JPEG bytes of a photo, or null. With thumb, its thumbnail if it has one (else the picture itself). */
export function readPhoto(id: string, thumb = false): Buffer | null {
  let hit: ReturnType<typeof locate>;
  try { hit = locate(id); } catch { return null; }
  if (!hit) return null;
  if (thumb) { try { return fs.readFileSync(thumbFile(id, hit.day)); } catch { /* no thumbnail yet: the picture itself */ } }
  try { return fs.readFileSync(hit.file); } catch { return null; }
}

/** Keep a thumbnail for a photo the PC has. It is written to a .part file first, so a read never sees half of it. */
export function saveThumb(id: string, data: Buffer): { ok: true } | { ok: false; error: string } {
  if (!safeId(id)) return { ok: false, error: 'bad_id' };
  if (data.length === 0 || data.length > THUMB_MAX_BYTES) return { ok: false, error: 'too_big' };
  if (!isJpeg(data)) return { ok: false, error: 'not_jpeg' };
  let hit: ReturnType<typeof locate>;
  try { hit = locate(id); } catch { return { ok: false, error: 'read_failed' }; }
  if (!hit) return { ok: false, error: 'not_found' };
  const file = thumbFile(id, hit.day), part = `${file}.part`;
  if (!insidePhotos(file) || !insidePhotos(part)) return { ok: false, error: 'bad_id' };
  fs.writeFileSync(part, data);
  fs.renameSync(part, file);
  return { ok: true };
}

/** A path only counts if it is inside the photos folder: deletion never reaches anywhere else. */
export function insidePhotos(file: string): boolean {
  const rel = path.relative(PHOTOS, path.resolve(file));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Files derived from a photo in its day folder: its thumbnail, and a leftover thumbnail .part. Named exactly for this
 * id, so another photo whose id starts the same way is never touched.
 */
function derivedFiles(id: string, day: string): string[] {
  return [thumbFile(id, day), `${thumbFile(id, day)}.part`].filter(f => fs.existsSync(f) && insidePhotos(f));
}

/**
 * Delete photos by id, with their derived files, and the day folder when it is left empty.
 * deleted: removed now. missing: not on the PC (already gone, which is fine). failed: could not be removed.
 */
export function deletePhotos(ids: string[]): { deleted: string[]; missing: string[]; failed: string[] } {
  const out = { deleted: [] as string[], missing: [] as string[], failed: [] as string[] };
  for (const id of new Set(ids)) {
    let hit: ReturnType<typeof locate>;
    try { hit = locate(id); } catch { out.failed.push(id); continue; }   // the folder could not be read: not known to be gone
    if (!hit) { out.missing.push(id); continue; }
    try { fs.unlinkSync(hit.file); } catch { out.failed.push(id); continue; }
    out.deleted.push(id);
    for (const f of derivedFiles(id, hit.day)) { try { fs.unlinkSync(f); } catch { /* a leftover thumbnail is harmless */ } }
    try { if (fs.readdirSync(path.dirname(hit.file)).length === 0) fs.rmdirSync(path.dirname(hit.file)); } catch { /* keep the folder */ }
  }
  return out;
}

export interface PhotoItem { id: string; at: string; url: string; hasThumb: boolean }
export interface PhotoDay { day: string; photos: PhotoItem[] }

/**
 * Photos newest first, grouped by day, up to limit. more: true when photos were left out at the limit.
 * No folder yet means no photos; any other read error is thrown, so the caller can say so.
 */
export function listPhotosPage(limit = 500): { days: PhotoDay[]; more: boolean } {
  const out: PhotoDay[] = [];
  let days: string[] = [];
  try { days = fs.readdirSync(PHOTOS).filter(d => DAY.test(d)).sort().reverse(); } catch (e) { if (missing(e)) return { days: out, more: false }; throw e; }
  let left = limit;
  let more = false;
  for (const day of days) {
    if (left <= 0) { more = true; break; }
    const names = new Set<string>();
    try { for (const f of fs.readdirSync(path.join(PHOTOS, day))) names.add(f); } catch (e) { if (missing(e)) continue; throw e; }
    const items: { id: string; mtime: number; hasThumb: boolean }[] = [];
    for (const f of names) {
      // a thumbnail is named <id>_thumb.jpg: it is not a photo of its own
      if (!f.endsWith('.jpg') || f.endsWith('_thumb.jpg')) continue;
      const id = f.slice(0, -4);
      if (!safeId(id)) continue;
      try { items.push({ id, mtime: fs.statSync(path.join(PHOTOS, day, f)).mtimeMs, hasThumb: names.has(`${id}_thumb.jpg`) }); } catch { /* gone */ }
    }
    items.sort((a, b) => b.mtime - a.mtime);
    const kept = items.slice(0, left);
    left -= kept.length;
    if (items.length > kept.length) more = true;
    if (kept.length) out.push({ day, photos: kept.map(p => ({ id: p.id, at: new Date(p.mtime).toISOString(), url: `/api/photos/file?id=${p.id}`, hasThumb: p.hasThumb })) });
  }
  return { days: out, more };
}

/** Every photo, newest first, grouped by day, up to limit (see listPhotosPage). */
export function listPhotos(limit = 500): PhotoDay[] {
  return listPhotosPage(limit).days;
}
