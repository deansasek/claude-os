// The Home dashboard's layout: rooms, their order, which devices are on the dashboard and where, and custom names.
//
// Kept on the PC in .ha-layout.json (outside src/, so it is never served), with one layout for the demo house
// and one for the real one. Every layout that comes in is cleaned here: unknown shapes are refused, ids must look
// like Home Assistant ids of a kind that may be shown (never locks, alarms, scripts...), names are trimmed.
//
// Being on the dashboard is not being allowed for Claude: that is only the allowlist in .ha-config.json (ha.ts).
import fs from 'node:fs';
import path from 'node:path';
import { HUB, writeJsonFile } from '../../../core/server/paths.ts';
import {
  ENTITY_ID, MAX_DEVICE_NAME, MAX_HOME_SCENES, MAX_ROOM_NAME, MAX_ROOMS, ROOM_ID, isDeniedDomain, isReadOnlyDomain, isSceneDomain, isShownDomain,
  type HaLayout, type HaRoom,
} from '../api.ts';

const FILE = path.join(HUB, '.ha-layout.json');
const MAX_DEVICES = 400;

/** The demo house as it first appears: three rooms, and a few devices left to add. */
const DEMO_DEFAULT: HaLayout = {
  rooms: [
    { id: 'rliving', name: 'Living room', devices: ['scene.movie_night', 'scene.good_morning', 'light.living_room', 'media_player.speaker', 'climate.thermostat'] },
    { id: 'rkitchen', name: 'Kitchen', devices: ['light.kitchen', 'switch.coffee_machine'] },
    { id: 'rbedroom', name: 'Bedroom', devices: ['fan.bedroom_fan'] },
  ],
  other: ['sensor.outdoor_temperature'],
  names: {},
};
const EMPTY: HaLayout = { rooms: [], other: [], names: {} };

interface Store { demo?: HaLayout; real?: HaLayout }

const clone = (l: HaLayout): HaLayout => JSON.parse(JSON.stringify(l)) as HaLayout;

/** May this id be on the dashboard? A shown kind, and never one that is denied (covers are shown read-only). */
export const showable = (id: string): boolean => {
  if (!ENTITY_ID.test(id)) return false;
  const d = id.split('.')[0];
  return isShownDomain(d) && (!isDeniedDomain(d) || isReadOnlyDomain(d));
};

/** Plain text: no control characters, single spaces, trimmed, at most `max` characters. */
function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

let roomSeq = 0;
const newRoomId = (): string => `r${Date.now().toString(36)}${(roomSeq++).toString(36)}`.slice(0, 24);

/**
 * A clean copy of a layout, or null when it isn't one. `known`, when given, is the set of ids that exist (the demo
 * house); anything else is dropped. A device is kept once, in the first place it appears.
 */
export function cleanLayout(raw: unknown, known?: Set<string>): HaLayout | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.rooms !== undefined && !Array.isArray(r.rooms)) return null;
  if (r.other !== undefined && !Array.isArray(r.other)) return null;
  const seen = new Set<string>();
  const ids = (a: unknown): string[] => {
    const out: string[] = [];
    if (!Array.isArray(a)) return out;
    for (const x of a) {
      if (typeof x !== 'string' || seen.has(x) || !showable(x) || (known && !known.has(x)) || seen.size >= MAX_DEVICES) continue;
      seen.add(x); out.push(x);
    }
    return out;
  };
  const roomIds = new Set<string>();
  const rooms: HaRoom[] = [];
  for (const x of (r.rooms as unknown[] | undefined) ?? []) {
    if (rooms.length >= MAX_ROOMS) break;
    if (!x || typeof x !== 'object') continue;
    const room = x as Record<string, unknown>;
    let id = typeof room.id === 'string' && ROOM_ID.test(room.id) ? room.id : newRoomId();
    while (roomIds.has(id)) id = newRoomId();
    roomIds.add(id);
    rooms.push({ id, name: cleanText(room.name, MAX_ROOM_NAME) || 'Room', devices: ids(room.devices) });
  }
  const other = ids(r.other);
  const names: Record<string, string> = {};
  if (r.names && typeof r.names === 'object' && !Array.isArray(r.names)) {
    for (const [k, v] of Object.entries(r.names as Record<string, unknown>)) {
      const n = cleanText(v, MAX_DEVICE_NAME);
      if (n && seen.has(k)) names[k] = n;
    }
  }
  const out: HaLayout = { rooms, other, names };
  // the Home screen's scenes: scene ids only, each once, at most MAX_HOME_SCENES (they need not be on the dashboard)
  if (Array.isArray(r.homeScenes)) {
    out.homeScenes = [...new Set(r.homeScenes.filter((x): x is string =>
      typeof x === 'string' && ENTITY_ID.test(x) && isSceneDomain(x.split('.')[0]) && (!known || known.has(x))))].slice(0, MAX_HOME_SCENES);
  }
  return out;
}

function load(): Store {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^﻿/, '')) as Record<string, unknown>;
    const s: Store = {};
    const demo = cleanLayout(raw.demo), real = cleanLayout(raw.real);
    if (demo) s.demo = demo;
    if (real) s.real = real;
    return s;
  } catch { return {}; }
}
let store = load();

function persist(): boolean {
  try {
    writeJsonFile(FILE, store, { indent: 2, mode: 0o600 });
    return true;
  } catch (e) {
    console.log('home-assistant: could not save the layout:', (e as NodeJS.ErrnoException).code ?? 'error');
    return false;
  }
}

/** The layout for the demo house or the real one (a copy). */
export function getLayout(demo: boolean): HaLayout {
  return clone((demo ? store.demo ?? DEMO_DEFAULT : store.real) ?? EMPTY);
}

export const dashboardIds = (demo: boolean): string[] => {
  const l = getLayout(demo);
  return [...l.rooms.flatMap(r => r.devices), ...l.other];
};
export const onDashboard = (demo: boolean, id: string): boolean => dashboardIds(demo).includes(id);

function put(demo: boolean, l: HaLayout): { ok: boolean; layout: HaLayout; error?: string } {
  if (demo) store.demo = l; else store.real = l;
  const ok = persist();
  return ok ? { ok: true, layout: clone(l) } : { ok: false, layout: getLayout(demo), error: 'The PC couldn’t save the layout.' };
}

/** Replace the whole layout (what the page sends after a drag, a rename, a new room...). */
export function saveLayout(demo: boolean, raw: unknown, known?: Set<string>): { ok: boolean; layout: HaLayout; error?: string } {
  const l = cleanLayout(raw, known);
  if (!l) return { ok: false, layout: getLayout(demo), error: 'That isn’t a dashboard layout.' };
  if (l.homeScenes === undefined) {   // a layout sent without the Home screen's scenes keeps the saved ones
    const cur = getLayout(demo).homeScenes;
    if (cur) l.homeScenes = cur;
  }
  return put(demo, l);
}

/** The Home screen's scenes, in order: the saved picks, else `fallback` (the demo scenes in the demo house). */
export function homeScenes(demo: boolean, fallback: string[] = []): string[] {
  return getLayout(demo).homeScenes ?? fallback.slice(0, MAX_HOME_SCENES);
}

/** Put a scene on the Home screen's quick actions (at the end) or take it off. Refused when three are there already. */
export function setHomeScene(demo: boolean, id: string, on: boolean, fallback: string[] = [], known?: Set<string>): { ok: boolean; home: string[]; error?: string } {
  const l = getLayout(demo);
  const cur = l.homeScenes ?? fallback.slice(0, MAX_HOME_SCENES);
  if (!ENTITY_ID.test(id) || !isSceneDomain(id.split('.')[0]) || (known && !known.has(id))) return { ok: false, home: cur, error: 'Only scenes can go on the Home screen.' };
  let next = cur.filter(x => x !== id);
  if (on) {
    if (cur.includes(id)) return { ok: true, home: cur };
    if (cur.length >= MAX_HOME_SCENES) return { ok: false, home: cur, error: `The Home screen has room for ${MAX_HOME_SCENES} scenes. Take one off first.` };
    next = [...cur, id];
  }
  l.homeScenes = next;
  const r = put(demo, l);
  return r.ok ? { ok: true, home: r.layout.homeScenes ?? next } : { ok: false, home: cur, error: r.error };
}

/** Add one device to the dashboard (into `room`, or Other), or take it off (its custom name goes with it). */
export function setOnDashboard(demo: boolean, id: string, on: boolean, room?: string, known?: Set<string>): { ok: boolean; layout: HaLayout; error?: string } {
  const l = getLayout(demo);
  if (!showable(id) || (known && !known.has(id))) return { ok: false, layout: l, error: 'That device can’t be shown on Home.' };
  const has = [...l.rooms.flatMap(r => r.devices), ...l.other].includes(id);
  if (on) {
    if (has) return { ok: true, layout: l };
    if (dashboardIds(demo).length >= MAX_DEVICES) return { ok: false, layout: l, error: 'Home is full.' };
    const target = l.rooms.find(r => r.id === room);
    (target ? target.devices : l.other).push(id);
  } else {
    if (!has) return { ok: true, layout: l };
    for (const r of l.rooms) r.devices = r.devices.filter(x => x !== id);
    l.other = l.other.filter(x => x !== id);
    delete l.names[id];
  }
  return put(demo, l);
}
