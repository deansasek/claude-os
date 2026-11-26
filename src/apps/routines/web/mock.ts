// Routines in the mock page (no hub): the list starts empty and is kept for the session, so a routine saved, deleted
// or restored shows on the next read. Nothing is saved after a reload. The shapes are the ones in ../api.ts.
import { defineMock } from '../../../core/web/mock-api.ts';
import type { Routine, RoutinesResult } from '../api.ts';

let routines: Routine[] = [];
let counter = 0;
const reply = (extra: Partial<RoutinesResult> = {}): RoutinesResult => ({ ok: true, routines, stored: true, ...extra });

defineMock({
  'GET /api/routines/list': (): RoutinesResult => reply(),
  'POST /api/routines/save': ({ body }): RoutinesResult => {
    const b = body as { routine?: unknown } | null;
    const r = ('routine' in (b ?? {}) ? b?.routine : body) as Partial<Routine> | null;
    if (!r || typeof r.name !== 'string' || !r.name.trim()) return reply({ ok: false, error: 'Give the routine a name.' });
    const id = typeof r.id === 'string' && r.id ? r.id : `rt${Date.now().toString(36)}${counter++}`;
    const saved: Routine = { id, name: r.name.trim(), phrases: Array.isArray(r.phrases) ? r.phrases.map(String) : [], steps: Array.isArray(r.steps) ? r.steps : [], ...(r.at ? { at: r.at } : {}) };
    routines = [...routines.filter(x => x.id !== id), saved];
    return reply({ id });
  },
  'POST /api/routines/delete': ({ body }): RoutinesResult => {
    const id = (body as { id?: unknown } | null)?.id;
    routines = routines.filter(r => r.id !== id);
    return reply();
  },
  'POST /api/routines/restore': ({ body }): RoutinesResult => {
    const saved = (body as { routines?: unknown } | null)?.routines;
    if (!Array.isArray(saved)) return reply({ ok: false, error: 'That isn’t a routines backup.' });
    for (const r of saved as Routine[]) if (r && typeof r.id === 'string' && !routines.some(x => x.id === r.id)) routines.push(r);
    return reply();
  },
});
