// The Apps screen's layout in the mock page (no hub): one layout per screen, kept for the session. Nothing is saved
// after a reload. The shapes are the ones in ../api.ts.
import { defineMock } from '../../../core/web/mock-api.ts';
import type { LauncherLayout, LauncherLayoutResult, LauncherScreen } from '../api.ts';

const layouts: Partial<Record<LauncherScreen, LauncherLayout>> = {};
const screenOf = (v: unknown): LauncherScreen => (v === 'hub' ? 'hub' : 'tablet');
const isLayout = (v: unknown): v is LauncherLayout =>
  !!v && typeof v === 'object' && Array.isArray((v as LauncherLayout).order) && Array.isArray((v as LauncherLayout).hidden);

defineMock({
  'GET /api/launcher/layout': ({ query }): LauncherLayoutResult => {
    const screen = screenOf(query.get('screen'));
    return { ok: true, screen, layout: layouts[screen] ?? null };
  },
  'POST /api/launcher/layout': ({ body }): LauncherLayoutResult => {
    const b = body as { screen?: unknown; layout?: unknown } | null;
    const screen = screenOf(b?.screen);
    if (!isLayout(b?.layout)) return { ok: false, screen, layout: layouts[screen] ?? null, error: 'That layout is not valid.' };
    layouts[screen] = { order: b.layout.order.map(String), hidden: b.layout.hidden.map(String) };
    return { ok: true, screen, layout: layouts[screen] ?? null };
  },
});
