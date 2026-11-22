// The routines, kept on the PC in hub/.routines.json (outside src/, so it is never served).
//
// The file is read again for every request, cleaned as it is read (a bad step or routine is dropped, not trusted), and
// written whole through a .tmp file. Everything that comes in is checked here: names and phrases trimmed and capped,
// steps checked (api.ts cleanRoutine), and every scene must be on the Home Assistant dashboard or the Home screen,
// the same rule as the scene routes (ha.ts sceneOnHome / activateScene).
//
// Only when there is no file at all, the two built-in routines are made and saved: "Good morning" (the weather, today's
// calendar, then the scene "Good morning" if it is on the Home screen) and "Good night" (say "Good night", then the
// scene "Movie night" if it is on the Home screen). A scene that isn't there is simply left out.
import fs from 'node:fs';
import path from 'node:path';
import { HUB } from '../../../core/server/paths.ts';
import { scenes, sceneOnHome } from '../../home-assistant/server/ha.ts';
import {
  MAX_ROUTINES, ROUTINE_ID, cleanRoutine, findRoutine, phraseKey, type Routine, type RoutinesResult, type Step,
} from '../api.ts';

export const FILE = path.join(HUB, '.routines.json');

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** One stored routine, cleaned; null when it isn't one. Scenes aren't checked against Home here (Home may change). */
function cleanStored(raw: unknown): Routine | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = (raw as Record<string, unknown>).id;
  if (typeof id !== 'string' || !ROUTINE_ID.test(id)) return null;
  const c = cleanRoutine(raw);
  return 'error' in c ? null : { id, ...c };
}

/** The built-in routines, with only the scenes that are on the Home screen now. */
async function defaults(): Promise<Routine[]> {
  let home: { entity_id: string; name: string }[] = [];
  try {
    const s = await scenes();
    if (s.status === 'ok') home = s.scenes.filter(x => x.home);
  } catch { /* Home Assistant away: no scene steps */ }
  const scene = (name: string): Step[] => {
    const hit = home.find(x => phraseKey(x.name) === phraseKey(name));
    return hit ? [{ kind: 'scene', entity_id: hit.entity_id }] : [];
  };
  return [
    { id: 'good-morning', name: 'Good morning', phrases: ['good morning'], steps: [{ kind: 'weather' }, { kind: 'calendar' }, ...scene('Good morning')] },
    { id: 'good-night', name: 'Good night', phrases: ['good night'], steps: [{ kind: 'say', text: 'Good night' }, ...scene('Movie night')] },
  ];
}

function persist(routines: Routine[]): boolean {
  try {
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ routines }, null, 1), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, FILE);
    return true;
  } catch (e) {
    console.log('routines: could not save:', (e as NodeJS.ErrnoException).code ?? 'error');
    return false;
  }
}

/** The routines from the file (the built-ins, saved, when there is no file); null when the file can't be read. */
async function load(): Promise<Routine[] | null> {
  let text: string;
  try { text = fs.readFileSync(FILE, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return null;
    const d = await defaults();
    if (!fs.existsSync(FILE)) persist(d);   // a request that read at the same moment may have made it already
    return d;
  }
  try {
    const raw = JSON.parse(text.replace(/^﻿/, '')) as { routines?: unknown };
    if (!raw || !Array.isArray(raw.routines)) return null;
    const out: Routine[] = [];
    for (const r of raw.routines) {
      if (out.length >= MAX_ROUTINES) break;
      const c = cleanStored(r);
      if (c && !out.some(o => o.id === c.id || phraseKey(o.name) === phraseKey(c.name))) out.push(c);
    }
    return out;
  } catch { return null; }
}

const UNREADABLE = 'The routines file on the PC couldn’t be read, so nothing was changed.';

export async function readRoutines(): Promise<RoutinesResult> {
  const r = await load();
  return r ? { ok: true, routines: r } : { ok: false, routines: [], error: UNREADABLE };
}

/** An id from a name: "Good morning" → "good-morning"; a different one if that is taken. */
function idFor(name: string, list: Routine[]): string {
  let base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(base)) base = `r-${base}`.replace(/-+$/, '');
  base = base.slice(0, 24).replace(/-+$/, '') || 'routine';
  let id = base, n = 2;
  while (list.some(l => l.id === id)) id = `${base}-${n++}`;
  return id;
}

/** Add a routine (no id, or an id not saved yet) or replace one (its id). Everything is checked again here. */
export async function saveRoutine(raw: unknown): Promise<RoutinesResult> {
  const list = await load();
  if (!list) return { ok: false, routines: [], error: UNREADABLE };
  const fail = (error: string): RoutinesResult => ({ ok: false, routines: list, error });
  const c = cleanRoutine(raw);
  if ('error' in c) return fail(c.error);
  for (const s of c.steps) {
    if (s.kind === 'scene' && !sceneOnHome(s.entity_id)) {
      return fail(`The scene ${s.entity_id} isn’t on the Home Assistant dashboard or the Home screen, so a routine can’t set it.`);
    }
  }
  const rawId = (raw as Record<string, unknown>).id;
  const id = typeof rawId === 'string' && rawId ? rawId : '';
  if (id && !ROUTINE_ID.test(id)) return fail('That isn’t a routine.');
  const at = id ? list.findIndex(r => r.id === id) : -1;
  const others = list.filter((_, i) => i !== at);
  if (others.some(o => phraseKey(o.name) === phraseKey(c.name))) return fail(`There’s already a routine called ${c.name}.`);
  for (const p of c.phrases) {
    const o = others.find(x => x.phrases.some(q => phraseKey(q) === phraseKey(p)));
    if (o) return fail(`“${p}” already runs ${o.name}.`);
  }
  let saved: Routine;
  if (at >= 0) { saved = { id, ...c }; list[at] = saved; }
  else {
    if (list.length >= MAX_ROUTINES) return fail(`There are already ${MAX_ROUTINES} routines. Delete one first.`);
    saved = { id: id || idFor(c.name, list), ...c };
    if (list.some(r => r.id === saved.id)) saved.id = idFor(c.name, list);
    list.push(saved);
  }
  if (!persist(list)) return { ok: false, routines: (await load()) ?? list, error: 'The PC couldn’t save the routines.' };
  return { ok: true, routines: clone(list), id: saved.id };
}

export async function deleteRoutine(idRaw: unknown): Promise<RoutinesResult> {
  const list = await load();
  if (!list) return { ok: false, routines: [], error: UNREADABLE };
  if (typeof idRaw !== 'string' || !ROUTINE_ID.test(idRaw)) return { ok: false, routines: list, error: 'That isn’t a routine.' };
  const at = list.findIndex(r => r.id === idRaw);
  if (at < 0) return { ok: true, routines: list };   // already gone
  list.splice(at, 1);
  if (!persist(list)) return { ok: false, routines: (await load()) ?? list, error: 'The PC couldn’t save the routines.' };
  return { ok: true, routines: list };
}

/** One routine by id or name (Claude's run_routine). */
export async function routineByName(ref: string): Promise<{ routine?: Routine; all: Routine[]; error?: string }> {
  const r = await readRoutines();
  if (!r.ok) return { all: [], error: r.error };
  return { routine: findRoutine(r.routines, ref), all: r.routines };
}
