// The Home Assistant client, the demo house, and the rules for what may be switched.
//
// Config lives in .ha-config.json on the PC (outside src/, so it is never served). The token never leaves this
// process: the page only ever sees it masked, and it is never logged. Every call to Home Assistant has a 5 s
// timeout, and a failure comes back as an error message, never a crash.
//
// Rules (for the page's routes and for Claude's tools alike):
//   - only the domains in CONTROL_DOMAINS (light, switch, media_player, fan, climate) are ever called;
//     DENIED_DOMAINS (locks, alarms, covers, scripts, automations, homeassistant, hassio) are refused outright.
//     Covers and sensors may be shown on the dashboard, read-only; locks, alarms, scripts... are never listed;
//   - Claude may call only devices on the allowlist (Settings > Apps > Home Assistant);
//   - the page may switch only devices on its dashboard (layout.ts). Being on the dashboard never allows Claude;
//   - only the services in SERVICES below, and the only extra data ever sent is a climate temperature;
//   - scenes (domain "scene") are shown and activated with scene.turn_on only, never anything else (activateScene).
//     The page, voice and Claude alike may activate only a scene on the dashboard or in the Home screen's picks (a
//     real scene may include locks or covers); Claude's calls also go through the approval card.
import fs from 'node:fs';
import path from 'node:path';
import { STATE, readJsonOrSetAside, writeJsonFile } from '../../../core/server/paths.ts';
import {
  ENTITY_ID, isControlDomain, isDeniedDomain, isOn, isReadOnlyDomain, isSceneDomain, isShownDomain, isVoiceDomain, type ControlDomain, type HaConfigUpdate,
  type HaDashboard, type HaDevice, type HaDevices, type HaEntities, type HaEntity, type HaHomeScenesResult, type HaLayoutResult, type HaResult,
  type HaScene, type HaScenes, type HaStatus, type HaTestResult,
} from '../api.ts';
import { getLayout, homeScenes, onDashboard, saveLayout as saveLayoutFile, setHomeScene as setHomeSceneFile, setOnDashboard } from './layout.ts';

// CLAUDEOS_HA_CONFIG is for the tests only: a scratch file instead of the house's config (it holds the token).
const FILE = process.env.CLAUDEOS_HA_CONFIG || path.join(STATE, '.ha-config.json');
const TIMEOUT_MS = 5000;
const MAX_DEVICES = 400;

interface Config {
  address: string;
  token: string;
  allow: string[];         // the real house's allowlist
  allowDemo?: string[];    // the demo house's allowlist (all demo devices until changed)
}

// ---------- config ----------
function load(): Config {
  const empty: Config = { address: '', token: '', allow: [] };
  if (!fs.existsSync(FILE)) return empty;
  // a config that can't be read is kept aside as a .corrupt copy (never over an earlier copy), so the token in it is not lost
  const c = readJsonOrSetAside<unknown>(FILE);
  if (!c || typeof c !== 'object' || Array.isArray(c)) return empty;
  const cfgRaw = c as Partial<Config>;
  return {
    address: typeof cfgRaw.address === 'string' ? cfgRaw.address : '',
    token: typeof cfgRaw.token === 'string' ? cfgRaw.token : '',
    allow: Array.isArray(cfgRaw.allow) ? cfgRaw.allow.filter(x => typeof x === 'string') : [],
    allowDemo: Array.isArray(cfgRaw.allowDemo) ? cfgRaw.allowDemo.filter(x => typeof x === 'string') : undefined,
  };
}
let cfg = load();

/** Write the config to the PC. False when it could not be written: the change then lasts only until a restart. */
function save(): boolean {
  try { writeJsonFile(FILE, cfg, { indent: 2, mode: 0o600 }); return true; }
  catch (e) { console.log('home-assistant: could not save the config:', (e as NodeJS.ErrnoException).code ?? 'error'); return false; }
}

// CLAUDEOS_HA_DEMO=1 is for the tests only: it shows the made-up house. A normal start never sets it, and no route
// or saved config can turn it on. Read on each call, so a test can set and clear it.
export const isDemo = (): boolean => process.env.CLAUDEOS_HA_DEMO === '1';
/** No address or token saved (and not the test house): the app says so and makes nothing up. */
export const notSetUp = (): boolean => !isDemo() && (!cfg.address || !cfg.token);
export const NOT_SET_UP = 'Home Assistant isn’t set up yet. Add its address and access token in Settings > Apps > Home Assistant.';
const mask = (t: string): string => (t ? `••••${t.slice(-4)}` : '');

let lastOk: boolean | null = null, lastError = '';
function note(ok: boolean, error = ''): void { lastOk = ok; lastError = error; }

export function status(): HaStatus {
  const demo = isDemo();
  return {
    configured: !!(cfg.address && cfg.token), demo,
    connected: demo ? null : lastOk, address: cfg.address, token: mask(cfg.token),
    ...(!demo && lastOk === false && lastError ? { error: lastError } : {}),
  };
}

/** "http://homeassistant.local:8123/" → "http://homeassistant.local:8123"; null when it isn't an http(s) address. */
function cleanAddress(raw: string): string | null {
  let s = raw.trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) return null;   // ftp://, file://...
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password || u.search || u.hash) return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch { return null; }
}

export function saveConfig(u: HaConfigUpdate): HaStatus & { ok: boolean; message?: string } {
  if (typeof u.address === 'string') {
    const a = cleanAddress(u.address.slice(0, 300));
    if (a == null) return { ...status(), ok: false, message: 'That doesn’t look like an address. Try http://homeassistant.local:8123' };
    if (a !== cfg.address) { cfg.address = a; lastOk = null; lastError = ''; }
  }
  if (typeof u.token === 'string') {
    const t = u.token.trim();
    if (t.length > 1000 || /\s/.test(t)) return { ...status(), ok: false, message: 'That token has spaces in it or is too long.' };
    if (t !== cfg.token) { cfg.token = t; lastOk = null; lastError = ''; }
  }
  if (!save()) return { ...status(), ok: false, message: 'The PC couldn’t save the address and token. They work until the PC restarts; save them again.' };
  console.log(`home-assistant: settings saved (address ${cfg.address ? 'set' : 'empty'}, token ${cfg.token ? 'set' : 'empty'})`);
  return { ...status(), ok: true };
}

// ---------- talking to Home Assistant ----------
class HaError extends Error {}

function reason(e: unknown): string {
  if (e instanceof HaError) return e.message;
  const err = e as Error & { cause?: { code?: string } };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'Home Assistant didn’t answer within 5 seconds.';
  const code = err?.cause?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'That address couldn’t be found on the network.';
  if (code === 'ECONNREFUSED') return 'Nothing answered at that address (connection refused).';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'That address can’t be reached from the PC.';
  if (code && /CERT|SSL|TLS/i.test(code)) return 'The secure connection failed (certificate problem).';
  return 'Couldn’t reach Home Assistant.';
}

async function haFetch(pathname: string, body?: unknown): Promise<unknown> {
  if (!cfg.address || !cfg.token) throw new HaError('Set the address and the access token in Settings first.');
  const res = await fetch(`${cfg.address}${pathname}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',   // never follow a redirect with the token on it
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) throw new HaError('Home Assistant refused the access token.');
  if (res.status === 404) throw new HaError('Home Assistant doesn’t know that (404). Check the address and the device.');
  if (res.status >= 300 && res.status < 400) throw new HaError('That address redirects somewhere else. Use Home Assistant’s own address.');
  if (!res.ok) throw new HaError(`Home Assistant answered with an error (${res.status}).`);
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { throw new HaError('That address answered, but not like Home Assistant does.'); }
}

/** Run a call to Home Assistant, remembering whether it worked; a failure is a message, never a throw. */
async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try { const value = await fn(); note(true); return { ok: true, value }; }
  catch (e) { const error = reason(e); note(false, error); return { ok: false, error }; }
}

interface RawState { entity_id: string; state: string; attributes?: Record<string, unknown> }

function toEntity(s: RawState): HaEntity | null {
  if (!s || typeof s.entity_id !== 'string') return null;
  if (!ENTITY_ID.test(s.entity_id)) return null;
  const domain = s.entity_id.split('.')[0];
  // shown: the control domains, and covers and sensors read-only; never locks, alarms, scripts, automations...
  if (!isShownDomain(domain) || (isDeniedDomain(domain) && !isReadOnlyDomain(domain))) return null;
  const a = s.attributes ?? {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const str = (v: unknown, max = 40) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);
  const e: HaEntity = {
    entity_id: s.entity_id, domain, state: String(s.state).slice(0, 60),
    name: (str(a.friendly_name, 100)) || s.entity_id,
    on: isOn(domain, String(s.state)),
  };
  if (!isControlDomain(domain) && !isSceneDomain(domain)) {
    e.readonly = true;
    const dc = str(a.device_class), unit = str(a.unit_of_measurement, 12);
    if (dc) e.deviceClass = dc;
    if (unit) e.unit = unit;
  }
  if (domain === 'climate') {
    e.current = num(a.current_temperature); e.target = num(a.temperature);
    e.unit = typeof a.temperature_unit === 'string' ? a.temperature_unit : '°C';
  }
  if (domain === 'media_player' && typeof a.media_title === 'string') e.media = a.media_title.slice(0, 80);
  return e;
}

async function realStates(): Promise<HaEntity[]> {
  const raw = await haFetch('/api/states');
  if (!Array.isArray(raw)) throw new HaError('That address answered, but not like Home Assistant does.');
  return (raw as RawState[]).map(toEntity).filter((e): e is HaEntity => !!e).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- the demo house (in memory only) ----------
const DEMO: HaEntity[] = [
  { entity_id: 'light.living_room', domain: 'light', name: 'Living room', state: 'on', on: true },
  { entity_id: 'light.kitchen', domain: 'light', name: 'Kitchen', state: 'off', on: false },
  { entity_id: 'switch.coffee_machine', domain: 'switch', name: 'Coffee machine', state: 'off', on: false },
  { entity_id: 'media_player.speaker', domain: 'media_player', name: 'Speaker', state: 'paused', on: true, media: 'Morning jazz' },
  { entity_id: 'fan.bedroom_fan', domain: 'fan', name: 'Bedroom fan', state: 'off', on: false },
  { entity_id: 'climate.thermostat', domain: 'climate', name: 'Thermostat', state: 'heat', on: true, current: 21, target: 21, unit: '°C' },
  { entity_id: 'light.hallway', domain: 'light', name: 'Hallway', state: 'off', on: false },
  { entity_id: 'light.bedside_lamp', domain: 'light', name: 'Bedside lamp', state: 'off', on: false },
  { entity_id: 'sensor.outdoor_temperature', domain: 'sensor', name: 'Outside', state: '8.5', on: false, readonly: true, unit: '°C', deviceClass: 'temperature' },
  { entity_id: 'sensor.living_room_humidity', domain: 'sensor', name: 'Living room humidity', state: '46', on: false, readonly: true, unit: '%', deviceClass: 'humidity' },
  { entity_id: 'binary_sensor.front_door', domain: 'binary_sensor', name: 'Front door', state: 'off', on: false, readonly: true, deviceClass: 'door' },
  { entity_id: 'cover.garage_door', domain: 'cover', name: 'Garage door', state: 'closed', on: false, readonly: true, deviceClass: 'garage' },
  // scenes: Home Assistant reports a scene's state as when it was last activated
  { entity_id: 'scene.movie_night', domain: 'scene', name: 'Movie night', state: 'unknown', on: false },
  { entity_id: 'scene.good_morning', domain: 'scene', name: 'Good morning', state: 'unknown', on: false },
];
const DEMO_IDS = new Set(DEMO.map(d => d.entity_id));
/** What each demo scene does: [device, service, track?]. */
const DEMO_SCENES: Record<string, [string, string, string?][]> = {
  'scene.movie_night': [
    ['light.kitchen', 'turn_off'], ['light.hallway', 'turn_off'], ['light.living_room', 'turn_off'],
    ['light.bedside_lamp', 'turn_on'], ['media_player.speaker', 'media_play', 'Rainy day piano'],
  ],
  'scene.good_morning': [
    ['light.living_room', 'turn_on'], ['light.kitchen', 'turn_on'], ['switch.coffee_machine', 'turn_on'],
    ['media_player.speaker', 'media_play', 'Morning jazz'], ['climate.thermostat', 'turn_on'],
  ],
};
const DEMO_HOME_SCENES = Object.keys(DEMO_SCENES);
/** Claude's demo allowlist until it is changed: the six devices the demo house always had. */
const DEMO_ALLOW = ['light.living_room', 'light.kitchen', 'switch.coffee_machine', 'media_player.speaker', 'fan.bedroom_fan', 'climate.thermostat'];
const TRACKS = ['Morning jazz', 'Rainy day piano', 'Kitchen radio', 'Quiet focus'];

function demoApply(e: HaEntity, service: string, temperature?: number): void {
  const onState = e.domain === 'media_player' ? 'playing' : e.domain === 'climate' ? 'heat' : 'on';
  const set = (s: string) => { e.state = s; e.on = isOn(e.domain, s); };
  switch (service) {
    case 'turn_on': set(onState); break;
    case 'turn_off': set('off'); break;
    case 'toggle': set(e.on ? 'off' : onState); break;
    case 'media_play': set('playing'); break;
    case 'media_pause': set('paused'); break;
    case 'media_play_pause': set(e.state === 'playing' ? 'paused' : 'playing'); break;
    case 'media_stop': set('idle'); break;
    case 'media_next_track': case 'media_previous_track': {
      const i = TRACKS.indexOf(e.media ?? '');
      e.media = TRACKS[(i + (service === 'media_next_track' ? 1 : TRACKS.length - 1)) % TRACKS.length];
      break;
    }
    case 'set_temperature': if (temperature != null) e.target = temperature; break;
  }
}

// ---------- the allowlist ----------
const allowList = (): string[] => (isDemo() ? cfg.allowDemo ?? DEMO_ALLOW : cfg.allow);
const allowed = (id: string): boolean => allowList().includes(id);

export function setAllowed(entityId: string, on: boolean): { ok: boolean; error?: string } {
  const id = String(entityId ?? '');
  const domain = id.split('.')[0];
  if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(id) || isDeniedDomain(domain) || !isControlDomain(domain)) return { ok: false, error: 'That kind of device can’t be allowed.' };
  const list = allowList().filter(x => x !== id);
  // a full list refuses the device; it is not dropped while the call still says ok
  if (on && !isDemo() && list.length >= 500) return { ok: false, error: 'Claude can control up to 500 devices. Turn one off first.' };
  if (on) list.push(id);
  if (isDemo()) cfg.allowDemo = list; else cfg.allow = list;
  if (!save()) return { ok: false, error: 'The PC couldn’t save that device. It works until the PC restarts; try again.' };
  return { ok: true };
}

// ---------- what the routes and the tools call ----------
/** Only the allowlisted devices (what Claude may control), with their state. */
export async function entities(): Promise<HaEntities> {
  const mine = (e: HaEntity) => isControlDomain(e.domain) && allowed(e.entity_id);
  if (isDemo()) return { status: 'ok', demo: true, entities: DEMO.filter(mine).map(e => ({ ...e })) };
  if (notSetUp()) return { status: 'not_set_up', demo: false, entities: [], error: NOT_SET_UP };
  const r = await attempt(realStates);
  if (!r.ok) return { status: 'error', demo: false, entities: [], error: r.error };
  return { status: 'ok', demo: false, entities: r.value.filter(mine) };
}

/** Every device Home Assistant reports that may be shown (for "Add device" and for the allowlist in Settings). */
export async function devices(): Promise<HaDevices> {
  const demo = isDemo();
  const pick = (list: HaEntity[]): HaDevice[] => list.slice(0, MAX_DEVICES).map(e => ({
    entity_id: e.entity_id, name: e.name, domain: e.domain,
    allowed: isControlDomain(e.domain) && allowed(e.entity_id),
    controllable: isControlDomain(e.domain),
    dashboard: onDashboard(demo, e.entity_id),
  }));
  if (demo) return { status: 'ok', demo: true, devices: pick(DEMO) };
  if (notSetUp()) return { status: 'not_set_up', demo: false, devices: [], error: NOT_SET_UP };
  const r = await attempt(realStates);
  if (!r.ok) return { status: 'error', demo: false, devices: [], error: r.error };
  return { status: 'ok', demo: false, devices: pick(r.value) };
}

// ---------- the dashboard (layout.ts keeps the layout) ----------
/** The layout and the state of every device on it. A device Home Assistant didn't report shows as missing. */
export async function dashboard(): Promise<HaDashboard> {
  const demo = isDemo();
  const layout = getLayout(demo);
  if (notSetUp()) return { status: 'not_set_up', demo, layout, entities: [], error: NOT_SET_UP };
  const ids = [...layout.rooms.flatMap(r => r.devices), ...layout.other];
  let states: HaEntity[] = [], error: string | undefined;
  if (demo) states = DEMO.map(e => ({ ...e }));
  else if (ids.length) {
    const r = await attempt(realStates);
    if (r.ok) states = r.value; else error = r.error;
  }
  const byId = new Map(states.map(e => [e.entity_id, e]));
  const entities = ids.map(id => byId.get(id) ?? {
    entity_id: id, domain: id.split('.')[0], name: id, state: 'unavailable', on: false, missing: true,
    ...(isControlDomain(id.split('.')[0]) || isSceneDomain(id.split('.')[0]) ? {} : { readonly: true }),
  });
  return { status: error ? 'error' : 'ok', demo, layout, entities, ...(error ? { error } : {}) };
}

export function saveLayout(raw: unknown): HaLayoutResult {
  const demo = isDemo();
  return saveLayoutFile(demo, raw, demo ? DEMO_IDS : undefined);
}

export function setDashboard(entityId: string, on: boolean, room?: string): HaLayoutResult {
  const demo = isDemo();
  return setOnDashboard(demo, String(entityId ?? ''), on, room, demo ? DEMO_IDS : undefined);
}

export async function test(): Promise<HaTestResult> {
  if (!cfg.address) return { ok: false, message: 'No address is set yet.' };
  if (!cfg.token) return { ok: false, message: 'No access token is set yet.' };
  const r = await attempt(() => haFetch('/api/'));
  if (!r.ok) return { ok: false, message: r.error };
  const msg = (r.value as { message?: unknown } | null)?.message;
  return { ok: true, message: typeof msg === 'string' ? `Connected: ${msg.slice(0, 80)}` : 'Connected.' };
}

/** The services each domain may use. Nothing else is ever called. */
const SERVICES: Record<ControlDomain, string[]> = {
  light: ['turn_on', 'turn_off', 'toggle'],
  switch: ['turn_on', 'turn_off', 'toggle'],
  fan: ['turn_on', 'turn_off', 'toggle'],
  media_player: ['turn_on', 'turn_off', 'toggle', 'media_play', 'media_pause', 'media_play_pause', 'media_stop', 'media_next_track', 'media_previous_track', 'volume_up', 'volume_down'],
  climate: ['turn_on', 'turn_off', 'set_temperature'],
};
export const servicesFor = (d: ControlDomain): string[] => SERVICES[d];

/** Who is asking: Claude (its tools: the allowlist decides) or the page (a tile tap: the dashboard decides). */
export type Caller = 'claude' | 'page';

/**
 * Call one service on one device. Every check happens here, whoever is asking: Claude may only call allowlisted
 * devices; the page may only switch devices on its dashboard. Nobody may call a denied domain.
 */
export async function callService(domain: string, service: string, entityId: string, temperature?: number, by: Caller = 'claude'): Promise<HaResult> {
  domain = String(domain ?? ''); service = String(service ?? ''); entityId = String(entityId ?? '');
  if (isDeniedDomain(domain) || isDeniedDomain(entityId.split('.')[0])) return { ok: false, error: `${domain || 'That'} devices can’t be controlled from ClaudeOS.` };
  if (!isControlDomain(domain)) return { ok: false, error: `Only lights, switches, fans, media players and thermostats can be controlled.` };
  if (!ENTITY_ID.test(entityId) || entityId.split('.')[0] !== domain) return { ok: false, error: `${entityId} isn’t a ${domain} device.` };
  if (!SERVICES[domain].includes(service)) return { ok: false, error: `${domain}.${service} isn’t allowed. Allowed: ${SERVICES[domain].join(', ')}.` };
  if (by === 'claude' && !allowed(entityId)) return { ok: false, error: `${entityId} isn’t on the list of devices Claude may control (Settings > Apps > Home Assistant).` };
  if (by === 'page' && !onDashboard(isDemo(), entityId)) return { ok: false, error: `${entityId} isn’t on the Home dashboard.` };
  let temp: number | undefined;
  if (service === 'set_temperature') {
    temp = Number(temperature);
    if (!Number.isFinite(temp) || temp < 5 || temp > 35) return { ok: false, error: 'Give a temperature between 5 and 35.' };
    temp = Math.round(temp * 2) / 2;
  }

  if (isDemo()) {
    const e = DEMO.find(d => d.entity_id === entityId);
    if (!e) return { ok: false, error: `There is no ${entityId} in the demo house.` };
    demoApply(e, service, temp);
    return { ok: true, entity: { ...e } };
  }
  const r = await attempt(async () => {
    await haFetch(`/api/services/${domain}/${service}`, temp == null ? { entity_id: entityId } : { entity_id: entityId, temperature: temp });
    return toEntity(await haFetch(`/api/states/${entityId}`) as RawState);
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, ...(r.value ? { entity: r.value } : {}) };
}

// ---------- scenes ----------
interface SceneRow extends HaScene { haName: string; entity: HaEntity }

/** "Movie night", "movie-night scene" → "movie night". */
const sceneKey = (s: string): string =>
  s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^the /, '').replace(/ scene$/, '');

async function sceneRows(): Promise<{ ok: true; demo: boolean; rows: SceneRow[]; home: string[] } | { ok: false; demo: boolean; error: string }> {
  const demo = isDemo();
  if (notSetUp()) return { ok: false, demo, error: NOT_SET_UP };
  let list: HaEntity[];
  if (demo) list = DEMO.filter(e => isSceneDomain(e.domain)).map(e => ({ ...e }));
  else {
    const r = await attempt(realStates);
    if (!r.ok) return { ok: false, demo, error: r.error };
    list = r.value.filter(e => isSceneDomain(e.domain));
  }
  const l = getLayout(demo);
  const home = homeScenes(demo, demo ? DEMO_HOME_SCENES : []);
  const rows = list.slice(0, MAX_DEVICES).map(e => ({
    entity_id: e.entity_id, name: l.names[e.entity_id] || e.name, haName: e.name, entity: e,
    dashboard: onDashboard(demo, e.entity_id), home: home.includes(e.entity_id),
  }));
  return { ok: true, demo, rows, home: home.filter(id => rows.some(s => s.entity_id === id)) };
}

/** Every scene Home Assistant reports (the demo scenes in demo mode), and the Home screen's picks in order. */
export async function scenes(): Promise<HaScenes> {
  const r = await sceneRows();
  if (!r.ok) return { status: r.error === NOT_SET_UP ? 'not_set_up' : 'error', demo: r.demo, scenes: [], home: [], error: r.error };
  return { status: 'ok', demo: r.demo, home: r.home, scenes: r.rows.map(({ entity_id, name, dashboard, home }) => ({ entity_id, name, dashboard, home })) };
}

/** Put a scene on the Home screen's quick actions, or take it off (saved with the layout on the PC). */
export function setHomeScene(entityId: string, on: boolean): HaHomeScenesResult {
  const demo = isDemo();
  return setHomeSceneFile(demo, String(entityId ?? ''), on, demo ? DEMO_HOME_SCENES : [], demo ? DEMO_IDS : undefined);
}

/** Is this scene on the dashboard or in the Home screen's picks (the rule activateScene applies)? Read from the saved
 *  layout only, so it answers even when Home Assistant can't be reached. Used by routines (routines/server/store.ts). */
export function sceneOnHome(entityId: string): boolean {
  const demo = isDemo();
  if (!ENTITY_ID.test(entityId) || !isSceneDomain(entityId.split('.')[0])) return false;
  return onDashboard(demo, entityId) || homeScenes(demo, demo ? DEMO_HOME_SCENES : []).includes(entityId);
}

/**
 * Activate one scene (scene.turn_on), by entity id or by name. Only domain "scene": any other id is refused before
 * anything is looked up. Whoever asks (a tile, voice, Claude), the scene must be on the dashboard or in the Home
 * screen's picks. Never calls anything but scene.turn_on.
 */
export async function activateScene(ref: string, by: Caller = 'claude'): Promise<HaResult & { name?: string }> {
  ref = String(ref ?? '').trim().slice(0, 120);
  if (!ref) return { ok: false, error: 'Say which scene.' };
  let id = '';
  if (ref.includes('.') && !/\s/.test(ref)) {   // an entity id
    const domain = ref.split('.')[0];
    if (!isSceneDomain(domain)) return { ok: false, error: `Only scenes can be set this way, and ${ref} isn’t a scene.` };
    if (!ENTITY_ID.test(ref)) return { ok: false, error: `${ref} isn’t a scene id.` };
    id = ref;
  }
  const r = await sceneRows();
  if (!r.ok) return { ok: false, error: r.error };
  let s: SceneRow | undefined;
  if (id) s = r.rows.find(x => x.entity_id === id);
  else {
    const want = sceneKey(ref);
    const hits = r.rows.filter(x => sceneKey(x.name) === want || sceneKey(x.haName) === want);
    if (hits.length > 1) return { ok: false, error: `More than one scene is called “${ref}”. Use its id: ${hits.map(h => h.entity_id).join(', ')}.` };
    s = hits[0];
  }
  if (!s) {
    const names = r.rows.map(x => `${x.name} (${x.entity_id})`).slice(0, 30).join(', ');
    return { ok: false, error: `There is no scene ${id || `called “${ref}”`}${r.demo ? ' in the demo house' : ''}. ${names ? `Scenes: ${names}.` : 'Home Assistant reported no scenes.'}` };
  }
  // the same rule for everyone: a scene may set locks or covers, so only one the user put on Home may be activated
  if (!s.dashboard && !s.home) {
    return by === 'page'
      ? { ok: false, error: `${s.name} isn’t on Home.`, name: s.name }
      : { ok: false, error: `The scene ${s.name} isn’t on the Home screen or the Home Assistant dashboard yet, so I can’t set it. You can add it there first.`, name: s.name };
  }

  if (r.demo) {
    for (const [dev, service, track] of DEMO_SCENES[s.entity_id] ?? []) {
      const e = DEMO.find(d => d.entity_id === dev);
      if (!e) continue;
      demoApply(e, service);
      if (track) e.media = track;
    }
    const e = DEMO.find(d => d.entity_id === s!.entity_id);
    if (e) e.state = new Date().toISOString();
    return { ok: true, name: s.name, ...(e ? { entity: { ...e } } : {}) };
  }
  const a = await attempt(() => haFetch('/api/services/scene/turn_on', { entity_id: s!.entity_id }));
  if (!a.ok) return { ok: false, error: a.error, name: s.name };
  console.log(`home-assistant: scene ${s.entity_id} set (${by})`);
  return { ok: true, name: s.name, entity: s.entity };
}

/** Turn a device on the dashboard on or off (or flip it when `on` is not given), as a tile tap does. */
export async function toggle(entityId: string, on?: boolean, voice = false): Promise<HaResult> {
  entityId = String(entityId ?? '');
  const domain = entityId.split('.')[0];
  // a voice command ("turn off the kitchen light"): only on/off, only lights, switches, fans and media players
  if (voice && (typeof on !== 'boolean' || !isVoiceDomain(domain) || isDeniedDomain(domain))) {
    return { ok: false, error: 'Voice can only turn lights, switches, fans and media players on or off.' };
  }
  const service = on === true ? 'turn_on' : on === false ? 'turn_off' : domain === 'climate' ? '' : 'toggle';
  if (!service) {   // climate has no toggle: look at its state first
    const d = await dashboard();
    const e = d.entities.find(x => x.entity_id === entityId && !x.missing);
    if (!e) return { ok: false, error: d.error ?? `${entityId} isn’t on the Home dashboard.` };
    return callService(domain, e.on ? 'turn_off' : 'turn_on', entityId, undefined, 'page');
  }
  return callService(domain, service, entityId, undefined, 'page');
}
