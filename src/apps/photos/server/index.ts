// Photos app routes (under /api/photos/); see ../api.ts for the shapes.
import type { Binary, ServerApp } from '../../../core/server/app.ts';
import { manifest } from '../manifest.ts';
import { THUMB_MAX_BYTES } from '../api.ts';
import { deletePhotos, listPhotos, MAX_BYTES, MAX_PER_DELETE, photoIdsFrom, readPhoto, safeId, savePhoto, saveThumb } from './store.ts';

const app: ServerApp = {
  id: manifest.id,
  routes: [
    {
      method: 'POST', path: 'upload', rawMax: MAX_BYTES, handle: ({ raw, headers, from }) => {
        const id = safeId(headers['x-photo-id']);
        if (!id) return { ok: false, error: 'bad_id' };
        if (!raw) return { ok: false, error: 'too_big' };
        const r = savePhoto(id, raw);
        if (!r.ok) return r;
        console.log(`photos: saved one from ${from}`);
        return { ok: true, id, url: `/api/photos/file?id=${id}` };
      },
    },
    {
      method: 'GET', path: 'list', handle: ({ query }) => {
        const limit = Math.max(1, Math.min(2000, Number(query.get('limit')) || 500));
        return { ok: true, days: listPhotos(limit) };
      },
    },
    {
      // size=thumb: the thumbnail if the PC has one, otherwise the picture itself
      method: 'GET', path: 'file', handle: ({ query }): Binary | { ok: false; error: string } => {
        const id = safeId(query.get('id'));
        const data = id ? readPhoto(id, query.get('size') === 'thumb') : null;
        if (!data) return { binary: true, status: 404, contentType: 'text/plain; charset=utf-8', body: Buffer.from('not found') };
        // a photo id names one picture; the browser may keep it for an hour (private: never shared caches)
        return { binary: true, contentType: 'image/jpeg', body: data, cache: 'private, max-age=3600' };
      },
    },
    {
      // a thumbnail for a photo the PC already has: raw JPEG body, the photo's id in ?id=
      method: 'POST', path: 'thumb', rawMax: THUMB_MAX_BYTES, handle: ({ query, raw }) => {
        const id = safeId(query.get('id'));
        if (!id) return { ok: false, error: 'bad_id' };
        if (!raw) return { ok: false, error: 'too_big' };
        const r = saveThumb(id, raw);
        if (!r.ok) return r;
        return { ok: true, id };
      },
    },
    {
      // {id} for one photo, or {ids} for several. Only ids that name a photo in the photos folder are touched.
      // → {ok, deleted, missing, failed}: ok is false only when some could not be removed.
      method: 'POST', path: 'delete', handle: ({ body, from }) => {
        const ids = body?.ids !== undefined ? photoIdsFrom(body.ids) : (safeId(body?.id) ? [safeId(body.id) as string] : null);
        if (!ids || ids.length === 0 || ids.length > MAX_PER_DELETE) return { ok: false, error: 'bad_id' };
        const r = deletePhotos(ids);
        if (r.deleted.length) console.log(`photos: deleted ${r.deleted.length} (asked from ${from})`);
        if (r.failed.length) console.log(`photos: could not delete ${r.failed.length} (asked from ${from})`);
        return { ok: r.failed.length === 0, ...r };
      },
    },
  ],
};
export default app;
