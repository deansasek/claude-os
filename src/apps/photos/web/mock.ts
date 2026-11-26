// Photos in the mock page (no hub): the library starts empty. Photos taken or uploaded in the session are kept until a
// reload, so the list, thumbnails and delete work. The picture files are not served (no JPEG to show), so the file
// route answers "not found". The shapes are the ones in ../api.ts.
import { defineMock } from '../../../core/web/mock-api.ts';
import type { PhotoDeleteResult, PhotoDay, PhotoItem, PhotoList, UploadResult } from '../api.ts';

const photos: { id: string; at: string }[] = [];
let counter = 0;

const item = (p: { id: string; at: string }): PhotoItem => ({ id: p.id, at: p.at, url: `/api/photos/file?id=${encodeURIComponent(p.id)}`, hasThumb: false });
const dayOf = (at: string): string => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const days = (): PhotoDay[] => {
  const byDay = new Map<string, PhotoItem[]>();
  for (const p of [...photos].reverse()) {   // newest first
    const day = dayOf(p.at);
    byDay.set(day, [...(byDay.get(day) ?? []), item(p)]);
  }
  return [...byDay].map(([day, list]) => ({ day, photos: list }));
};

defineMock({
  'GET /api/photos/list': (): PhotoList => ({ ok: true, days: days() }),
  'GET /api/photos/file': () => ({ status: 404, body: { ok: false, error: 'No picture files in the mock page.' } }),
  'POST /api/photos/upload': (): UploadResult => {
    const id = `mock${Date.now().toString(36)}${counter++}`;
    photos.push({ id, at: new Date().toISOString() });
    return { ok: true, id, url: `/api/photos/file?id=${encodeURIComponent(id)}` };
  },
  'POST /api/photos/thumb': ({ query }): { ok: boolean; id?: string } => ({ ok: photos.some(p => p.id === query.get('id')), id: query.get('id') ?? undefined }),
  'POST /api/photos/delete': ({ body }): PhotoDeleteResult => {
    const b = body as { id?: unknown; ids?: unknown } | null;
    const ids = Array.isArray(b?.ids) ? b.ids.map(String) : typeof b?.id === 'string' ? [b.id] : [];
    const deleted: string[] = [], missing: string[] = [];
    for (const id of ids) {
      const i = photos.findIndex(p => p.id === id);
      if (i < 0) missing.push(id); else { photos.splice(i, 1); deleted.push(id); }
    }
    return { ok: true, deleted, missing, failed: [] };
  },
});
