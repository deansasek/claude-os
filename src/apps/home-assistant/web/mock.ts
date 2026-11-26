// Home Assistant in the mock page (no hub): a made-up house with two lights, a plug, a thermometer and two scenes, in
// two rooms. Switching a light or a plug changes it for the session, and the dashboard shows the change. Settings
// cannot connect here, so the app says it is not set up. The shapes are the ones in ../api.ts. Nothing is real.
import { defineMock } from '../../../core/web/mock-api.ts';
import type {
  HaDashboard, HaDevices, HaEntities, HaEntity, HaHomeScenesResult, HaLayout, HaLayoutResult, HaResult, HaScene, HaScenes, HaStatus, HaTestResult,
} from '../api.ts';

const entities: HaEntity[] = [
  { entity_id: 'light.kitchen', domain: 'light', name: 'Kitchen light', state: 'on', on: true },
  { entity_id: 'light.living_room', domain: 'light', name: 'Living room light', state: 'off', on: false },
  { entity_id: 'switch.coffee', domain: 'switch', name: 'Coffee plug', state: 'off', on: false },
  { entity_id: 'sensor.hall_temperature', domain: 'sensor', name: 'Hall temperature', state: '19.5', on: false, readonly: true, unit: '°C', deviceClass: 'temperature' },
];
const allowed = new Set(['light.kitchen', 'light.living_room', 'switch.coffee']);
const scenes: HaScene[] = [
  { entity_id: 'scene.movie_night', name: 'Movie night', dashboard: true, home: true },
  { entity_id: 'scene.morning', name: 'Good morning', dashboard: true, home: false },
];
let home: string[] = ['scene.movie_night'];
let layout: HaLayout = {
  rooms: [{ id: 'rkitchen', name: 'Kitchen', devices: ['light.kitchen', 'switch.coffee'] }, { id: 'rliving', name: 'Living room', devices: ['light.living_room'] }],
  other: ['sensor.hall_temperature'],
  names: {},
  homeScenes: home,
};

const demo = true;
const status = (): HaStatus => ({ configured: false, demo, connected: null, address: '', token: '' });
const notSetUp = 'Home Assistant can’t be connected from this page. It needs the ClaudeOS PC or tablet.';
const find = (id: unknown): HaEntity | undefined => entities.find(e => e.entity_id === id);
const devices = () => entities.map(e => ({
  entity_id: e.entity_id, name: e.name, domain: e.domain, allowed: allowed.has(e.entity_id),
  controllable: e.domain !== 'sensor', dashboard: true,
}));
const sceneList = (): HaScene[] => scenes.map(s => ({ ...s, home: home.includes(s.entity_id) }));

defineMock({
  'GET /api/home-assistant/status': (): HaStatus => status(),
  'POST /api/home-assistant/config': (): HaResult => ({ ok: false, error: notSetUp }),
  'POST /api/home-assistant/test': (): HaTestResult => ({ ok: false, message: notSetUp }),
  'GET /api/home-assistant/entities': (): HaEntities => ({ status: 'ok', demo, entities: entities.filter(e => allowed.has(e.entity_id)) }),
  'GET /api/home-assistant/devices': (): HaDevices => ({ status: 'ok', demo, devices: devices() }),
  'POST /api/home-assistant/allow': ({ body }): HaResult => {
    const id = String((body as { entity_id?: unknown } | null)?.entity_id ?? '');
    if (!find(id)) return { ok: false, error: 'That device is not in this house.' };
    if ((body as { allowed?: unknown } | null)?.allowed === true) allowed.add(id); else allowed.delete(id);
    return { ok: true };
  },
  'POST /api/home-assistant/toggle': ({ body }): HaResult => {
    const b = body as { entity_id?: unknown; on?: unknown } | null;
    const e = find(b?.entity_id);
    if (!e || e.readonly) return { ok: false, error: 'That device cannot be switched.' };
    e.on = b?.on === true;
    e.state = e.on ? 'on' : 'off';
    return { ok: true, entity: e };
  },
  'GET /api/home-assistant/scenes': (): HaScenes => ({ status: 'ok', demo, scenes: sceneList(), home }),
  'POST /api/home-assistant/scene': (): HaResult => ({ ok: true }),   // a scene runs on the PC; nothing to change here
  'POST /api/home-assistant/home-scenes': ({ body }): HaHomeScenesResult => {
    const b = body as { entity_id?: unknown; on?: unknown } | null;
    const id = String(b?.entity_id ?? '');
    if (!scenes.some(s => s.entity_id === id)) return { ok: false, home, error: 'That scene is not in this house.' };
    home = b?.on === true ? [...home.filter(x => x !== id), id].slice(-3) : home.filter(x => x !== id);
    layout = { ...layout, homeScenes: home };
    return { ok: true, home };
  },
  'GET /api/home-assistant/layout': (): HaDashboard => ({ status: 'ok', demo, layout, entities }),
  'POST /api/home-assistant/layout': ({ body }): HaLayoutResult => {
    const next = body as HaLayout | null;
    if (!next || !Array.isArray(next.rooms)) return { ok: false, layout, error: 'That layout is not valid.' };
    layout = { ...next, homeScenes: home };
    return { ok: true, layout };
  },
  'POST /api/home-assistant/dashboard': (): HaResult => ({ ok: true }),
});
