// Apps screen routes (all under /api/launcher/). Every answer is a LauncherLayoutResult: {ok, screen, layout, error?}.
//   GET  layout?screen=tablet|hub   the saved layout of that screen (layout: null when none is saved yet)
//   POST layout  {screen, layout: {order, hidden}, allowed?: [package...]}
//                replaces that screen's layout; cleaned and saved in .launcher-layout.json (server/layout.ts).
//                A key of the wrong shape refuses the whole layout; a body over LAYOUT_MAX_BYTES is refused (413).
import type { ServerApp } from '../../../core/server/app.ts';
import { LAYOUT_MAX_BYTES } from '../api.ts';
import { manifest } from '../manifest.ts';
import { getLayout, saveLayout } from './layout.ts';

const app: ServerApp = {
  id: manifest.id,
  routes: [
    { method: 'GET', path: 'layout', handle: ({ query }) => getLayout(query.get('screen')) },
    {
      // read raw so an oversized body gets a clear 413 with this route's own size limit
      method: 'POST', path: 'layout', rawMax: LAYOUT_MAX_BYTES, handle: ({ raw, headers }) => {
        if (!String(headers['content-type'] || '').startsWith('application/json')) return { ok: false, screen: 'tablet', layout: null, error: 'Send JSON.' };
        let b: Record<string, unknown> | null = null;
        try { b = JSON.parse((raw ?? Buffer.alloc(0)).toString('utf8') || 'null') as Record<string, unknown> | null; } catch { b = null; }
        if (!b || typeof b !== 'object') return { ok: false, screen: 'tablet', layout: null, error: 'That isn’t an Apps layout.' };
        return saveLayout(b.screen, b.layout, b.allowed);
      },
    },
  ],
};
export default app;
