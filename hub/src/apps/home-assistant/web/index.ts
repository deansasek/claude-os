// The Home Assistant app: the user's home as a grid of rooms, each with its device tiles. Tapping a light, switch,
// fan or speaker turns it on or off through the PC (server/ha.ts); thermostats, covers and sensors show their state.
// The state refreshes every 15 s while the app is on screen.
//
// Edit (header) lets the user arrange it: drag a tile within a room or to another one; tap a tile (or hold it at any
// time) to rename it, move it to a room or take it off Home; add, rename and delete (empty) rooms; and "Add device"
// lists everything Home Assistant reports. Every change is saved on the PC at once (hub/.ha-layout.json).
//
// Being on Home never lets Claude control a device: that is only the allowlist in Settings > Apps > Home Assistant
// ("Devices Claude can control"), which is also where the address, the access token and demo mode are set.
import { esc, getJson, postJson } from '../../../core/web/dom.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { appSettingsChanged, registerAppSettings, type SettingRow } from '../../../core/web/app-settings.ts';
import { onBack } from '../../../core/web/system.ts';
import {
  MAX_DEVICE_NAME, MAX_HOME_SCENES, MAX_ROOMS, MAX_ROOM_NAME, isSceneDomain,
  type HaDashboard, type HaDevices, type HaEntity, type HaHomeScenesResult, type HaLayout, type HaLayoutResult, type HaResult,
  type HaScenes, type HaStatus, type HaTestResult,
} from '../api.ts';
import { manifest } from '../manifest.ts';

const API = `/api/${manifest.id}`;
const REFRESH_MS = 15e3;
const DEVICES_STALE_MS = 30e3;
const HOLD_MS = 520;          // a long-press opens a tile's settings
const DRAG_START_PX = 6;      // in edit mode, a tile moves once the finger has moved this far
const OTHER = '_other';       // the "Other" section's id on the page (room ids are "r…", so it never clashes)

const ICON = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">'
  + '<path d="M5 15L16 6l11 9"/><path d="M8 13v13h16V13"/><path d="M13.5 26v-6.5h5V26"/></svg>';

const svg = (inner: string) => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${inner}</svg>`;
const DOMAIN_ICON: Record<string, string> = {
  light: svg('<path d="M11.5 19.5a7 7 0 1 1 9 0c-1 .9-1.5 1.8-1.5 3H13c0-1.2-.5-2.1-1.5-3z"/><path d="M13 26h6"/>'),
  switch: svg('<rect x="6" y="11" width="20" height="10" rx="5"/><circle cx="21" cy="16" r="2.6"/>'),
  media_player: svg('<rect x="9" y="5" width="14" height="22" rx="3"/><circle cx="16" cy="19" r="3.5"/><circle cx="16" cy="10.5" r="1"/>'),
  fan: svg('<circle cx="16" cy="16" r="2"/><path d="M16 14c-1-4 0-8 3-8s3 5-1 8"/><path d="M18 16.5c4 1 7 4 5.5 6.5s-5.5.5-7-4"/><path d="M14.2 17c-3 3-7 3.5-8 1s3-5 7.5-3.2"/>'),
  climate: svg('<path d="M14 18.5V7a2 2 0 0 1 4 0v11.5a4.5 4.5 0 1 1-4 0z"/><path d="M16 21v-6"/>'),
  cover: svg('<path d="M6 26V11l10-5 10 5v15"/><path d="M10 26V15h12v11"/><path d="M10 18.5h12M10 22h12"/>'),
  sensor: svg('<path d="M7 22a9 9 0 1 1 18 0"/><path d="M16 22l4.5-6"/><circle cx="16" cy="22" r="1.3"/>'),
  binary_sensor: svg('<circle cx="16" cy="16" r="9"/><circle cx="16" cy="16" r="3"/>'),
  // a scene: a spark and two small ones (a set of states at once)
  scene: svg('<path d="M13 6.5l1.9 5.6 5.6 1.9-5.6 1.9L13 21.5l-1.9-5.6L5.5 14l5.6-1.9z"/><path d="M23 18.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"/><path d="M23 5.5v4M21 7.5h4"/>'),
};
const CLASS_ICON: Record<string, string> = {
  temperature: DOMAIN_ICON.climate,
  humidity: svg('<path d="M16 5.5c4 5 7 8.6 7 12.5a7 7 0 0 1-14 0c0-3.9 3-7.5 7-12.5z"/>'),
  door: svg('<path d="M9 27V5h14v22"/><path d="M6 27h20"/><circle cx="19" cy="16.5" r="1"/>'),
  window: svg('<rect x="7" y="6" width="18" height="20" rx="1.5"/><path d="M16 6v20M7 16h18"/>'),
  motion: svg('<circle cx="17" cy="6.5" r="2"/><path d="M14 27l2.5-7.5L20 22v5"/><path d="M11 15l3.5-4.5 4 2 2.5 3.5"/><path d="M16.5 19.5l1.5-7"/>'),
};
const iconFor = (domain: string, deviceClass?: string): string =>
  (deviceClass && (CLASS_ICON[deviceClass] ?? (/door|garage|opening/.test(deviceClass) ? CLASS_ICON.door : /occupancy|presence/.test(deviceClass) ? CLASS_ICON.motion : '')))
  || DOMAIN_ICON[domain] || DOMAIN_ICON.sensor;

const EDIT_ICON = svg('<path d="M20.5 7.5l4 4L12 24l-5 1 1-5z"/><path d="M18 10l4 4"/>');
const TICK = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 10.5l3.2 3.2L15 7"/></svg>';

// A device's kind, in plain words (never the Home Assistant domain name).
const DOMAIN_LABEL: Record<string, string> = {
  light: 'Light', switch: 'Switch', media_player: 'Speaker or TV', fan: 'Fan', climate: 'Thermostat',
  cover: 'Door or blind', sensor: 'Sensor', binary_sensor: 'Sensor', scene: 'Scene',
};
// "Add device" groups, in this order
const GROUPS: { domains: string[]; title: string }[] = [
  { domains: ['scene'], title: 'Scenes' },
  { domains: ['light'], title: 'Lights' },
  { domains: ['switch'], title: 'Switches' },
  { domains: ['fan'], title: 'Fans' },
  { domains: ['media_player'], title: 'Speakers and TVs' },
  { domains: ['climate'], title: 'Thermostats' },
  { domains: ['cover'], title: 'Doors and blinds · shown only' },
  { domains: ['sensor', 'binary_sensor'], title: 'Sensors · shown only' },
];

// Turn a technical error into one plain sentence. The raw text is never shown.
function plain(error?: string): string {
  const t = (error ?? '').toLowerCase();
  if (/401|403|unauthori[sz]ed|forbidden|token/.test(t)) return 'The access token was refused. Replace it in Settings, then Apps, then Home Assistant.';
  if (/timeout|timed out|abort|5 seconds/.test(t)) return 'Home Assistant took too long to answer. Check that it is switched on.';
  if (/econn|enotfound|refused|network|fetch|dns|unreachable|socket|host|reach|address/.test(t)) return 'Couldn’t reach Home Assistant. Check the address in Settings, and that it is on the same network.';
  return 'Something went wrong. Try again in a moment.';
}

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);

let status: HaStatus | null = null;
let dash: HaDashboard | null = null;
let devices: HaDevices | null = null, devicesAt = 0, devicesBusy = false;
let testMsg = '';
let note = '';
let editing = false;
let sheet: { kind: 'tile'; id: string } | { kind: 'add' } | null = null;
let addTo = OTHER;            // the room "Add device" puts new devices in
const busy = new Set<string>();
let timer: number | undefined;
let sceneList: HaScenes | null = null;    // every scene, and the Home screen's picks (Settings)
let sceneMsg = '';
/** A scene tile's brief answer after a tap: "Done" or "Couldn’t set". */
const flash = new Map<string, boolean>();
const FLASH_MS = 2400;
const isScene = (id: string) => isSceneDomain(id.split('.')[0]);

const emptyLayout = (): HaLayout => ({ rooms: [], other: [], names: {} });
const layout = (): HaLayout => dash?.layout ?? emptyLayout();
const ids = (l = layout()): string[] => [...l.rooms.flatMap(r => r.devices), ...l.other];
const entity = (id: string): HaEntity | undefined => dash?.entities.find(e => e.entity_id === id);
const nameOf = (id: string): string => layout().names[id] || entity(id)?.name || devices?.devices.find(d => d.entity_id === id)?.name || id;
const roomOf = (id: string): string => layout().rooms.find(r => r.devices.includes(id))?.id ?? OTHER;

// ---------- what a tile says ----------
function num(v: string): string {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? String(Math.round(n * 10) / 10) : v;
}

function stateLabel(e: HaEntity): string {
  if (e.missing) return 'Not found in Home Assistant';
  if (e.state === 'unavailable') return 'Not responding';
  if (e.domain === 'scene') {
    const f = flash.get(e.entity_id);
    return f === true ? 'Done' : f === false ? 'Couldn’t set' : busy.has(e.entity_id) ? 'Setting…' : 'Scene';
  }
  if (e.state === 'unknown') return 'No reading';
  switch (e.domain) {
    case 'climate': {
      if (!e.on) return 'Off';
      const mode = e.state === 'heat' ? 'Heating' : e.state === 'cool' ? 'Cooling' : e.state === 'auto' || e.state === 'heat_cool' ? 'Auto' : e.state;
      return e.target != null ? `${mode} to ${e.target}${e.unit ?? '°'}` : mode;
    }
    case 'media_player': {
      const s = e.state === 'playing' ? 'Playing' : e.state === 'paused' ? 'Paused' : e.state === 'idle' ? 'Idle' : e.on ? 'On' : 'Off';
      return e.media && e.on ? `${s} · ${e.media}` : s;
    }
    case 'cover':
      return ({ open: 'Open', closed: 'Closed', opening: 'Opening', closing: 'Closing' } as Record<string, string>)[e.state] ?? e.state;
    case 'binary_sensor': {
      const on = e.state === 'on', dc = e.deviceClass ?? '';
      if (/door|window|garage|opening/.test(dc)) return on ? 'Open' : 'Closed';
      if (/motion|occupancy|presence/.test(dc)) return on ? 'Movement' : 'Clear';
      if (dc === 'moisture') return on ? 'Wet' : 'Dry';
      return on ? 'On' : 'Off';
    }
    case 'sensor': {
      const dc = e.deviceClass ?? '';
      return dc ? dc.charAt(0).toUpperCase() + dc.slice(1).replace(/_/g, ' ') : 'Sensor';
    }
  }
  return e.on ? 'On' : 'Off';
}

const tappable = (e: HaEntity) => !e.readonly && !e.missing && e.domain !== 'climate' && e.state !== 'unavailable';

function tile(id: string): string {
  const e: HaEntity = entity(id) ?? { entity_id: id, domain: id.split('.')[0], name: id, state: 'unknown', on: false };
  const name = layout().names[id] || e.name;
  const scene = e.domain === 'scene';
  const f = flash.get(id);
  const cls = `ha-tile${e.on && !e.readonly ? ' on' : ''}${busy.has(id) ? ' busy' : ''}${e.readonly ? ' ro' : ''}${e.missing ? ' gone' : ''}`
    + `${scene ? ' scene' : ''}${f === true ? ' done' : f === false ? ' fail' : ''}`;
  let big = '';
  if (e.domain === 'climate' && e.current != null) big = `${Math.round(e.current * 10) / 10}°`;
  else if (e.domain === 'sensor' && !e.missing && e.state !== 'unavailable' && e.state !== 'unknown') big = `${num(e.state)}${e.unit ? (e.unit.startsWith('°') || e.unit === '%' ? e.unit : ` ${e.unit}`) : ''}`;
  const head = `<div class="ha-tile-top"><div class="ha-ico">${iconFor(e.domain, e.deviceClass)}</div>${big ? `<div class="ha-big num" title="${esc(big)}">${esc(big)}</div>` : ''}</div>`;
  const body = `${head}<div class="ha-text"><div class="ha-name" title="${esc(name)}">${esc(name)}</div><div class="ha-state">${esc(stateLabel(e))}</div></div>`;
  if (editing) {
    return `<div class="${cls} edit" data-id="${esc(id)}" role="button" aria-label="${esc(`${name}. Drag to move, tap for settings.`)}">${body}`
      + `<button class="ha-tile-edit hit hit-abs" data-act="tile" aria-label="${esc(`Settings for ${name}`)}">${EDIT_ICON}</button></div>`;
  }
  if (!tappable(e)) return `<div class="${cls}" data-id="${esc(id)}">${body}</div>`;
  if (scene) return `<button class="${cls}" data-id="${esc(id)}" aria-label="${esc(`${name}, a scene. Tap to set it.`)}">${body}</button>`;
  return `<button class="${cls}" data-id="${esc(id)}" aria-pressed="${e.on}" aria-label="${esc(`${name}, ${stateLabel(e)}. Tap to turn ${e.on ? 'off' : 'on'}.`)}">${body}</button>`;
}

interface Section { id: string; name: string; ids: string[]; other: boolean }
function sections(): Section[] {
  const l = layout();
  return [...l.rooms.map(r => ({ id: r.id, name: r.name, ids: r.devices, other: false })), { id: OTHER, name: 'Other', ids: l.other, other: true }];
}

function render(): void {
  if (!ctx || drag) return;   // never rebuild the tiles under a finger
  const demo = dash?.demo ?? status?.demo ?? true;
  const bad = !demo && (status?.connected === false || dash?.status === 'error');
  const mode = $('haMode');
  mode.textContent = demo ? 'Demo' : bad ? 'Not connected' : '';
  mode.hidden = !mode.textContent;
  mode.classList.toggle('bad', bad);
  $('haEdit').textContent = editing ? 'Done' : 'Edit';
  $('haEdit').classList.toggle('on', editing);
  $('haAdd').hidden = !editing;
  $('haAddRoom').hidden = !editing;
  $('haHint').hidden = !editing;

  const err = dash?.status === 'error' ? plain(dash.error) : '';
  $('haNote').hidden = !(note || err);
  $('haNote').textContent = note || err;

  const l = layout();
  const nothing = !!dash && !l.rooms.length && !ids(l).length;
  const shown = sections().filter(s => editing || s.ids.length);
  $('haRooms').innerHTML = nothing && !editing ? '' : shown.map(s => {
    const tools = editing && !s.other
      ? `<button class="ha-link hit" data-act="rename-room">Rename</button>${s.ids.length ? '' : '<button class="ha-link hit danger" data-act="delete-room">Delete</button>'}`
      : '';
    const drop = editing && !s.ids.length ? `<div class="ha-drop">${s.other ? 'Devices in no room' : 'Drag devices here'}</div>` : '';
    // a room's scenes come first, in their own row; then its devices
    const sc = s.ids.filter(isScene), dv = s.ids.filter(x => !isScene(x));
    const tiles = sc.length && dv.length ? `${sc.map(tile).join('')}<div class="ha-break" aria-hidden="true"></div>${dv.map(tile).join('')}` : s.ids.map(tile).join('');
    return `<section class="ha-room${editing ? ' edit' : ''}" data-room="${esc(s.id)}">`
      + `<div class="ha-room-hd"><h2 class="ha-room-name" title="${esc(s.name)}">${esc(s.name)}</h2>${tools}</div>`
      + `<div class="ha-grid" data-room="${esc(s.id)}">${tiles}${drop}</div></section>`;
  }).join('');
  $('haEmpty').hidden = !(nothing && !editing);
  if (sheet) renderSheet();
}

// ---------- talking to the PC ----------
async function loadStatus(): Promise<void> {
  try { status = await getJson<HaStatus>(`${API}/status`); } catch { /* keep the last one */ }
}

async function refresh(): Promise<void> {
  try { dash = await getJson<HaDashboard>(`${API}/layout`); note = ''; }
  catch { note = 'Can’t reach the PC right now.'; }
  await loadStatus();
  render();
  appSettingsChanged();
}

async function loadDevices(): Promise<void> {
  if (devicesBusy) return;
  devicesBusy = true;
  try { devices = await getJson<HaDevices>(`${API}/devices`); devicesAt = Date.now(); }
  catch { devices = { status: 'error', demo: status?.demo ?? true, devices: [], error: 'Can’t reach the PC right now.' }; devicesAt = Date.now(); }
  finally { devicesBusy = false; }
  await loadScenes();
  await loadStatus();
  if (sheet) renderSheet();
  appSettingsChanged();
}

/** Set a scene (scene.turn_on on the PC), then say "Done" or "Couldn’t set" on its tile for a moment. */
async function setScene(id: string): Promise<void> {
  if (busy.has(id)) return;
  busy.add(id);
  flash.delete(id);
  render();
  let r: HaResult;
  try { r = await postJson<HaResult>(`${API}/scene`, { entity_id: id }); }
  catch { r = { ok: false, error: 'Can’t reach the PC right now.' }; }
  busy.delete(id);
  flash.set(id, r.ok);
  note = r.ok ? '' : `Couldn’t set ${nameOf(id)}. ${r.error && /on Home/i.test(r.error) ? 'It isn’t on Home any more.' : plain(r.error)}`;
  render();
  setTimeout(() => { flash.delete(id); render(); }, FLASH_MS);
  if (r.ok) setTimeout(() => { void refresh(); }, 600);   // the devices the scene changed
}

async function tap(id: string): Promise<void> {
  const e = entity(id);
  if (!e || !tappable(e) || busy.has(id)) return;
  if (e.domain === 'scene') { void setScene(id); return; }
  busy.add(id);
  render();
  let r: HaResult;
  try { r = await postJson<HaResult>(`${API}/toggle`, { entity_id: id, on: !e.on }); }
  catch { r = { ok: false, error: 'Can’t reach the PC right now.' }; }
  busy.delete(id);
  if (r.ok && r.entity && dash) dash.entities = dash.entities.map(x => (x.entity_id === id ? r.entity! : x));
  note = r.ok ? '' : `${nameOf(id)} didn’t switch. ${r.error && /dashboard/i.test(r.error) ? 'It isn’t on Home any more.' : plain(r.error)}`;
  render();
  if (r.ok && !r.entity) void refresh();
}

/** Save the whole layout: it shows at once, and the PC's cleaned copy settles it. */
async function saveLayout(l: HaLayout): Promise<void> {
  if (dash) dash.layout = l;
  render();
  try {
    const r = await postJson<HaLayoutResult>(`${API}/layout`, { layout: l });
    if (dash) dash.layout = r.layout;
    note = r.ok ? '' : r.error ?? 'That wasn’t saved.';
  } catch { note = 'Can’t reach the PC right now, so that wasn’t saved.'; }
  render();
}

/** Add a device to Home (into `room`) or take it off. The state of a new device comes with the next refresh. */
async function setOnHome(id: string, on: boolean, room = OTHER): Promise<void> {
  const d = devices?.devices.find(x => x.entity_id === id);
  if (d) d.dashboard = on;
  if (dash) {   // show it at once
    const l = dash.layout;
    if (on && !ids(l).includes(id)) (l.rooms.find(r => r.id === room)?.devices ?? l.other).push(id);
    if (!on) { l.rooms.forEach(r => { r.devices = r.devices.filter(x => x !== id); }); l.other = l.other.filter(x => x !== id); delete l.names[id]; }
  }
  render();
  try {
    const r = await postJson<HaLayoutResult>(`${API}/dashboard`, { entity_id: id, on, ...(room !== OTHER ? { room } : {}) });
    if (dash) dash.layout = r.layout;
    note = r.ok ? '' : r.error ?? 'That wasn’t saved.';
  } catch { note = 'Can’t reach the PC right now, so that wasn’t saved.'; }
  await refresh();
}

async function saveConfig(body: { address?: string; token?: string; demo?: boolean }): Promise<void> {
  try {
    const r = await postJson<HaStatus & { ok: boolean; message?: string }>(`${API}/config`, body);
    status = r;
    testMsg = r.ok ? '' : r.message ?? 'That wasn’t saved.';
  } catch { testMsg = 'Can’t reach the PC right now.'; }
  appSettingsChanged();
  void loadDevices();
  void refresh();
}

async function runTest(): Promise<void> {
  testMsg = 'Testing…';
  appSettingsChanged();
  try { testMsg = (await postJson<HaTestResult>(`${API}/test`, {})).message; }
  catch { testMsg = 'Can’t reach the PC right now.'; }
  await loadStatus();
  appSettingsChanged();
}

async function loadScenes(): Promise<void> {
  try { sceneList = await getJson<HaScenes>(`${API}/scenes`); }
  catch { sceneList = { status: 'error', demo: status?.demo ?? true, scenes: [], home: [], error: 'Can’t reach the PC right now.' }; }
}

/** Put a scene on the Home screen's quick actions, or take it off. The Home screen picks it up when it next shows. */
async function setHomeScene(id: string, on: boolean): Promise<void> {
  const s = sceneList?.scenes.find(x => x.entity_id === id);
  if (on && sceneList && sceneList.home.length >= MAX_HOME_SCENES && !s?.home) {
    sceneMsg = `The Home screen has room for ${MAX_HOME_SCENES} scenes. Turn one off first.`;
    appSettingsChanged();
    return;
  }
  if (s) s.home = on;   // the switch moves at once; the PC's answer settles it
  appSettingsChanged();
  try {
    const r = await postJson<HaHomeScenesResult>(`${API}/home-scenes`, { entity_id: id, on });
    sceneMsg = r.ok ? '' : r.error ?? 'That wasn’t saved.';
    if (dash) dash.layout.homeScenes = r.home;
  } catch { sceneMsg = 'Can’t reach the PC right now, so that wasn’t saved.'; }
  await loadScenes();
  appSettingsChanged();
  dispatchEvent(new CustomEvent('hub:ha-scenes'));   // the Home screen redraws its quick actions
}

async function setAllowed(id: string, on: boolean): Promise<void> {
  const d = devices?.devices.find(x => x.entity_id === id);
  if (d) d.allowed = on;   // the switch moves at once; the PC's answer settles it
  appSettingsChanged();
  try { await postJson(`${API}/allow`, { entity_id: id, allowed: on }); } catch { /* the reload below shows the truth */ }
  await loadDevices();
}

// ---------- layout edits ----------
const copy = (): HaLayout => JSON.parse(JSON.stringify(layout())) as HaLayout;
const cleanName = (v: string, max: number) => v.replace(/\s+/g, ' ').trim().slice(0, max);

function addRoom(): void {
  if (layout().rooms.length >= MAX_ROOMS) { note = `Home can have up to ${MAX_ROOMS} rooms.`; render(); return; }
  Keyboard.open({ placeholder: 'Room name', autoCap: true, done: 'Add', max: MAX_ROOM_NAME, onDone: v => {
    const name = cleanName(v, MAX_ROOM_NAME);
    if (!name) return false;
    const l = copy();
    l.rooms.push({ id: `r${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, name, devices: [] });
    void saveLayout(l);
  } });
}

function renameRoom(roomId: string): void {
  const r = layout().rooms.find(x => x.id === roomId);
  if (!r) return;
  Keyboard.open({ value: r.name, placeholder: 'Room name', autoCap: true, done: 'Save', max: MAX_ROOM_NAME, onDone: v => {
    const name = cleanName(v, MAX_ROOM_NAME);
    if (!name) return false;
    const l = copy();
    const room = l.rooms.find(x => x.id === roomId);
    if (room) room.name = name;
    void saveLayout(l);
  } });
}

function deleteRoom(roomId: string): void {
  const l = copy();
  if (l.rooms.find(x => x.id === roomId)?.devices.length) return;   // only an empty room
  l.rooms = l.rooms.filter(x => x.id !== roomId);
  void saveLayout(l);
}

function renameDevice(id: string): void {
  const original = entity(id)?.name ?? id;
  Keyboard.open({ value: layout().names[id] ?? original, placeholder: original, autoCap: true, done: 'Save', max: MAX_DEVICE_NAME, onDone: v => {
    const name = cleanName(v, MAX_DEVICE_NAME);
    const l = copy();
    if (!name || name === original) delete l.names[id]; else l.names[id] = name;
    void saveLayout(l);
  } });
}

function moveDevice(id: string, roomId: string): void {
  if (roomOf(id) === roomId) return;
  const l = copy();
  l.rooms.forEach(r => { r.devices = r.devices.filter(x => x !== id); });
  l.other = l.other.filter(x => x !== id);
  (l.rooms.find(r => r.id === roomId)?.devices ?? l.other).push(id);
  void saveLayout(l);
}

// ---------- the sheet: a device's settings, or "Add devices" ----------
function chips(current: string, act: string): string {
  return sections().map(s => `<button class="ha-chip${s.id === current ? ' on' : ''}" data-act="${act}" data-room="${esc(s.id)}" aria-pressed="${s.id === current}" title="${esc(s.name)}">${esc(s.name)}</button>`).join('');
}

function renderSheet(): void {
  const card = $('haSheetCard');
  if (!sheet) return;
  if (sheet.kind === 'tile') {
    const id = sheet.id;
    if (!ids().includes(id)) { closeSheet(); return; }
    const e = entity(id);
    const name = nameOf(id);
    const kind = DOMAIN_LABEL[e?.domain ?? id.split('.')[0]] ?? 'Device';
    const renamed = !!layout().names[id] && e && e.name !== layout().names[id];
    const d = devices?.devices.find(x => x.entity_id === id);
    const claude = isScene(id) ? 'A scene: tap it to set it. Claude can set scenes too, and asks first. Choose the Home screen’s scenes in Settings, then Apps, then Home Assistant.'
      : e?.readonly ? 'Shown only. Nothing can switch it from here.'
      : !d ? '' : d.allowed ? 'Claude can control this. Change it in Settings, then Apps, then Home Assistant.'
      : 'Claude can’t control this. Allow it in Settings, then Apps, then Home Assistant.';
    card.className = 'ha-sheet-card';
    card.innerHTML = `<h3 title="${esc(name)}">${esc(name)}</h3>`
      + `<p class="ha-sub">${esc(kind)}${renamed ? ` · “${esc(e!.name)}” in Home Assistant` : ''}</p>`
      + `<div class="ha-srow"><span class="ha-slabel">Name</span><span class="ha-sval" title="${esc(name)}">${esc(name)}</span><button class="ha-btn" data-act="rename">Rename</button></div>`
      + `<div class="ha-srow col"><span class="ha-slabel">Room</span><div class="ha-chips">${chips(roomOf(id), 'move')}</div></div>`
      + (claude ? `<p class="ha-claude">${esc(claude)}</p>` : '')
      + `<div class="ha-sheet-btns"><button class="ha-btn danger" data-act="remove">Remove from Home</button><span class="ha-flex"></span><button class="ha-btn primary" data-act="close">Done</button></div>`;
    return;
  }
  // "Add devices": every device Home Assistant reports, grouped by kind; a tick puts it on Home
  const list = card.querySelector('.ha-list');
  const keep = list ? list.scrollTop : 0;
  const dev = devices;
  let rows = '';
  if (!dev) rows = '<p class="ha-muted">Loading…</p>';
  else if (dev.status === 'error') rows = `<p class="ha-muted">${esc(plain(dev.error))}</p>`;
  else if (!dev.devices.length) rows = '<p class="ha-muted">Home Assistant didn’t report any devices that can be shown.</p>';
  else {
    for (const g of GROUPS) {
      const items = dev.devices.filter(d => g.domains.includes(d.domain));
      if (!items.length) continue;
      rows += `<div class="ha-group">${esc(g.title)}</div>`;
      rows += items.map(d => {
        const on = ids().includes(d.entity_id);
        const ent = entity(d.entity_id);
        return `<button class="ha-row${on ? ' on' : ''}" data-act="pick" data-id="${esc(d.entity_id)}" aria-pressed="${on}">`
          + `<span class="ha-row-ico">${iconFor(d.domain, ent?.deviceClass)}</span>`
          + `<span class="ha-row-text"><span class="ha-row-name" title="${esc(d.name)}">${esc(d.name)}</span>`
          + `<span class="ha-row-sub">${esc(on ? `On Home · ${sections().find(s => s.ids.includes(d.entity_id))?.name ?? 'Other'}` : DOMAIN_LABEL[d.domain] ?? 'Device')}</span></span>`
          + `<span class="ha-tick">${on ? TICK : ''}</span></button>`;
      }).join('');
    }
  }
  if (!sections().some(s => s.id === addTo)) addTo = OTHER;
  card.className = 'ha-sheet-card wide';
  card.innerHTML = '<h3>Add devices</h3>'
    + '<p class="ha-sub">Tick a device to show it on Home. This doesn’t let Claude control it: that is in Settings.</p>'
    + `<div class="ha-srow col"><span class="ha-slabel">Add to</span><div class="ha-chips">${chips(addTo, 'addto')}</div></div>`
    + `<div class="ha-list">${rows}</div>`
    + '<div class="ha-sheet-btns"><span class="ha-flex"></span><button class="ha-btn primary" data-act="close">Done</button></div>';
  const nl = card.querySelector('.ha-list');
  if (nl) nl.scrollTop = keep;
}

function openSheet(s: NonNullable<typeof sheet>): void {
  sheet = s;
  if (s.kind === 'add' || Date.now() - devicesAt > DEVICES_STALE_MS) void loadDevices();
  $('haSheet').hidden = false;
  renderSheet();
}
function closeSheet(): void {
  sheet = null;
  $('haSheet').hidden = true;
  $('haSheetCard').innerHTML = '';
}

function onSheetClick(ev: Event): void {
  const t = ev.target as Element;
  if (t === $('haSheet')) { closeSheet(); return; }
  const b = t.closest<HTMLElement>('[data-act]');
  if (!b || !sheet) return;
  const act = b.dataset.act;
  if (act === 'close') { closeSheet(); return; }
  if (sheet.kind === 'tile') {
    const id = sheet.id;
    if (act === 'rename') renameDevice(id);
    else if (act === 'move' && b.dataset.room) moveDevice(id, b.dataset.room);
    else if (act === 'remove') { closeSheet(); void setOnHome(id, false); }
    return;
  }
  if (act === 'addto' && b.dataset.room) { addTo = b.dataset.room; renderSheet(); }
  else if (act === 'pick' && b.dataset.id) void setOnHome(b.dataset.id, !ids().includes(b.dataset.id), addTo);
}

// ---------- tap, hold and drag ----------
interface Press { id: string; el: HTMLElement; x: number; y: number; pid: number; timer?: number; held: boolean }
interface Drag { id: string; pid: number; el: HTMLElement; ghost: HTMLElement; ph: HTMLElement; ox: number; oy: number; x: number; y: number; raf: number }
let press: Press | null = null;
let drag: Drag | null = null;

function onDown(e: PointerEvent): void {
  if (!e.isPrimary || drag) return;
  const t = e.target as Element;
  if (t.closest('.ha-tile-edit')) return;   // its own click opens the settings
  const el = t.closest<HTMLElement>('.ha-tile');
  if (!el?.dataset.id) return;
  press = { id: el.dataset.id, el, x: e.clientX, y: e.clientY, pid: e.pointerId, held: false };
  const p = press;
  p.timer = window.setTimeout(() => {   // hold: the tile's settings, in either mode
    if (press !== p || drag) return;
    p.held = true;
    press = null;
    openSheet({ kind: 'tile', id: p.id });
  }, HOLD_MS);
}

function onMove(e: PointerEvent): void {
  if (drag) { if (e.pointerId !== drag.pid) return; drag.x = e.clientX; drag.y = e.clientY; placeGhost(); movePlaceholder(); return; }
  if (!press || e.pointerId !== press.pid) return;
  const d = Math.hypot(e.clientX - press.x, e.clientY - press.y);
  if (!editing) { if (d > 10) cancelPress(); return; }   // a scroll, not a tap
  if (d > DRAG_START_PX) startDrag(e);
}

function onUp(e: PointerEvent): void {
  if (drag) { if (e.pointerId === drag.pid) endDrag(true); return; }
  if (!press || e.pointerId !== press.pid) return;
  const p = press;
  cancelPress();
  if (p.held) return;
  if (editing) openSheet({ kind: 'tile', id: p.id });
  else void tap(p.id);
}

function onCancel(): void {
  if (drag) endDrag(false);
  cancelPress();
}

function cancelPress(): void {
  if (press?.timer) clearTimeout(press.timer);
  press = null;
}

/** The stage is scaled by a CSS transform: screen px → the app's own px. */
function local(x: number, y: number): { x: number; y: number } {
  const r = ctx.root.getBoundingClientRect();
  const s = r.width / (ctx.root.offsetWidth || r.width || 1) || 1;
  return { x: (x - r.left) / s, y: (y - r.top) / s };
}

function startDrag(e: PointerEvent): void {
  if (!press) return;
  const { id } = press;
  cancelPress();
  // the tile as it is now (a refresh may have redrawn it since the finger went down)
  const el = [...$('haRooms').querySelectorAll<HTMLElement>('.ha-tile')].find(t => t.dataset.id === id);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const at = local(r.left, r.top), p = local(e.clientX, e.clientY);
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.classList.add('ha-ghost');
  ghost.removeAttribute('data-id');
  ghost.style.width = `${el.offsetWidth}px`;
  ghost.style.height = `${el.offsetHeight}px`;
  ctx.root.appendChild(ghost);
  const ph = document.createElement('div');
  ph.className = 'ha-ph';
  ph.style.height = `${el.offsetHeight}px`;
  el.before(ph);
  el.hidden = true;
  drag = { id, pid: e.pointerId, el, ghost, ph, ox: p.x - at.x, oy: p.y - at.y, x: e.clientX, y: e.clientY, raf: 0 };
  placeGhost();
  const scroll = () => {   // near the top or the bottom edge, the page scrolls under the tile
    if (!drag) return;
    const sc = $('haScroll'), sr = sc.getBoundingClientRect();
    const edge = 56 * (sr.height / (sc.offsetHeight || sr.height || 1));
    const v = drag.y < sr.top + edge ? -1 : drag.y > sr.bottom - edge ? 1 : 0;
    if (v) { sc.scrollTop += v * 10; movePlaceholder(); }
    drag.raf = requestAnimationFrame(scroll);
  };
  drag.raf = requestAnimationFrame(scroll);
}

function placeGhost(): void {
  if (!drag) return;
  const p = local(drag.x, drag.y);
  drag.ghost.style.transform = `translate(${p.x - drag.ox}px, ${p.y - drag.oy}px) scale(1.03)`;
}

/** Put the placeholder where the tile would land: next to the nearest tile under the finger, or in an empty room. */
function movePlaceholder(): void {
  if (!drag) return;
  const { x, y, ph } = drag;
  const hit = document.elementFromPoint(x, y);
  if (!hit || !$('haRooms').contains(hit)) return;
  const grid = hit.closest<HTMLElement>('.ha-grid') ?? hit.closest('.ha-room')?.querySelector<HTMLElement>('.ha-grid');
  if (!grid) return;
  const tiles = [...grid.querySelectorAll<HTMLElement>(':scope > .ha-tile:not([hidden])')];
  if (!tiles.length) {
    grid.querySelector('.ha-drop')?.remove();
    if (ph.parentElement !== grid) grid.appendChild(ph);
    return;
  }
  let best = tiles[0], bd = Infinity;
  for (const t of tiles) {
    const r = t.getBoundingClientRect();
    const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
    if (d < bd) { bd = d; best = t; }
  }
  const r = best.getBoundingClientRect();
  const after = y > r.bottom || (y >= r.top && x > r.left + r.width / 2);
  const ref = after ? best.nextElementSibling : best;
  if (ref === ph || (after ? ph.previousElementSibling === best : ph.nextElementSibling === best)) return;
  grid.insertBefore(ph, ref);
}

function endDrag(commit: boolean): void {
  if (!drag) return;
  const d = drag;
  drag = null;
  cancelAnimationFrame(d.raf);
  d.ghost.remove();
  d.el.hidden = false;
  if (!commit) { d.ph.remove(); render(); return; }
  d.ph.replaceWith(d.el);
  // read the new order straight from the page
  const order = new Map<string, string[]>();
  $('haRooms').querySelectorAll<HTMLElement>('.ha-grid').forEach(g => {
    order.set(g.dataset.room ?? OTHER, [...g.querySelectorAll<HTMLElement>(':scope > .ha-tile')].map(t => t.dataset.id!).filter(Boolean));
  });
  const l = copy();
  l.rooms.forEach(r => { r.devices = order.get(r.id) ?? r.devices.filter(x => x !== d.id); });
  l.other = order.get(OTHER) ?? l.other.filter(x => x !== d.id);
  if (JSON.stringify(l) === JSON.stringify(layout())) { render(); return; }
  void saveLayout(l);
}

function onRoomsClick(ev: Event): void {
  const b = (ev.target as Element).closest<HTMLElement>('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'tile') {
    const id = b.closest<HTMLElement>('.ha-tile')?.dataset.id;
    if (id) openSheet({ kind: 'tile', id });
    return;
  }
  const room = b.closest<HTMLElement>('.ha-room')?.dataset.room;
  if (!room || room === OTHER) return;
  if (b.dataset.act === 'rename-room') renameRoom(room);
  else if (b.dataset.act === 'delete-room') deleteRoom(room);
}

function setEditing(on: boolean): void {
  if (drag) endDrag(false);
  cancelPress();
  editing = on;
  render();
}

// ---------- settings (Settings > Apps > Home Assistant) ----------
function settingRows(): SettingRow[] {
  if (Date.now() - devicesAt > DEVICES_STALE_MS) void loadDevices();
  const s = status;
  const demo = s?.demo ?? true;
  const rows: SettingRow[] = [
    { kind: 'info', id: 'mode', title: 'Status', detail: demo ? 'Demo mode: Home shows a made-up house so you can try it. Nothing real is switched.' : s?.error ? plain(s.error) : undefined,
      value: () => (demo ? 'Demo' : s?.connected ? 'Connected' : s?.connected === false ? 'Not connected' : 'Not tested yet') },
    { kind: 'action', id: 'address', title: 'Address', detail: 'For example http://homeassistant.local:8123',
      value: () => s?.address || 'Not set', label: s?.address ? 'Change' : 'Add',
      run: () => Keyboard.open({ value: s?.address ?? '', placeholder: 'http://homeassistant.local:8123', done: 'Save', max: 200,
        onDone: v => { void saveConfig({ address: v }); } }) },
    // the token is never shown: only whether one is saved
    { kind: 'action', id: 'token', title: 'Access token',
      detail: 'From your Home Assistant profile. Kept only on the PC. Save it empty to remove it.',
      value: () => (s?.token ? 'Saved' : 'Not set'), label: s?.token ? 'Replace' : 'Add',
      run: () => Keyboard.open({ placeholder: 'Type the access token', done: 'Save', max: 400, mask: true,
        onDone: v => { void saveConfig({ token: v }); } }) },
    { kind: 'action', id: 'test', title: 'Test connection', detail: testMsg || 'Checks the address and the token.', label: 'Test', run: () => { void runTest(); } },
    { kind: 'switch', id: 'demo', title: 'Demo mode',
      detail: s?.configured
        ? 'Show a made-up house instead of your home. Its rooms and devices are kept apart from your real ones.'
        : 'A made-up house to try Home with. On until an address and a token are saved.',
      get: () => demo, set: v => { void saveConfig({ demo: v }); } },
  ];
  const dev = devices;
  const allowable = (dev?.devices ?? []).filter(d => d.controllable);
  rows.push({ kind: 'info', id: 'allowHead', title: 'Devices Claude can control',
    detail: 'Claude can switch only the devices turned on here, and asks first. Adding a device to Home doesn’t allow it. Locks, alarms, doors and scripts are never offered.',
    value: () => (!dev ? 'Loading…' : dev.status === 'error' ? 'Couldn’t load' : `${allowable.filter(d => d.allowed).length} of ${allowable.length}`) });
  if (dev?.status === 'error') rows.push({ kind: 'info', id: 'allowErr', title: 'Couldn’t list your devices', detail: plain(dev.error), value: () => '' });
  for (const d of allowable) {
    rows.push({ kind: 'switch', id: `allow:${d.entity_id}`, title: d.name,
      detail: `${DOMAIN_LABEL[d.domain] ?? 'Device'}${d.dashboard ? ' · on Home' : ''}`,
      get: () => d.allowed, set: v => { void setAllowed(d.entity_id, v); } });
  }
  // the Home screen's quick actions: up to three scenes
  const sl = sceneList;
  rows.push({ kind: 'info', id: 'scenesHead', title: 'Scenes on the Home screen',
    detail: sceneMsg || `Up to ${MAX_HOME_SCENES} scenes show as one-tap buttons on the Home screen.${demo ? ' In demo mode these are the demo scenes.' : ''}`,
    value: () => (!sl ? 'Loading…' : sl.status === 'error' ? 'Couldn’t load' : `${sl.home.length} of ${MAX_HOME_SCENES}`) });
  if (sl?.status === 'ok' && !sl.scenes.length) rows.push({ kind: 'info', id: 'scenesNone', title: 'No scenes yet', detail: 'Make scenes in Home Assistant, and they show up here.', value: () => '' });
  for (const sc of sl?.status === 'ok' ? sl.scenes : []) {
    rows.push({ kind: 'switch', id: `homeScene:${sc.entity_id}`, title: sc.name,
      detail: `Scene${sc.dashboard ? ' · on the dashboard' : ''}`,
      get: () => sc.home, set: v => { void setHomeScene(sc.entity_id, v); } });
  }
  return rows;
}

// ---------- the app ----------
function start(): void { stop(); timer = window.setInterval(() => { void refresh(); }, REFRESH_MS); }
function stop(): void { if (timer) clearInterval(timer); timer = undefined; }

const app: HubApp = {
  ...manifest,
  title: 'Home',
  icon: ICON,
  mount(c) {
    ctx = c;
    const rooms = $('haRooms');
    rooms.addEventListener('pointerdown', onDown);
    rooms.addEventListener('click', onRoomsClick);
    rooms.addEventListener('contextmenu', e => e.preventDefault());   // a long-press is not a context menu
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onCancel);
    $('haEdit').addEventListener('click', () => setEditing(!editing));
    $('haAdd').addEventListener('click', () => openSheet({ kind: 'add' }));
    $('haAddRoom').addEventListener('click', addRoom);
    $('haEmptyGo').addEventListener('click', () => openSheet({ kind: 'add' }));
    $('haSheet').addEventListener('click', onSheetClick);
    // Back (system.ts): the sheet closes first, then edit mode ends
    onBack(() => {
      if (!ctx.isVisible() || Keyboard.isOpen) return false;
      if (sheet) { closeSheet(); return true; }
      if (editing) { setEditing(false); return true; }
      return false;
    }, 10);
    registerAppSettings({ app: manifest.id, name: manifest.name, icon: ICON, blurb: 'Address, access token, demo mode and the devices Claude can control', rows: settingRows });
    void loadStatus().then(() => { render(); appSettingsChanged(); });
    void loadDevices();
  },
  onShow() { void refresh(); start(); },
  onHide() {
    stop();
    if (drag) endDrag(false);
    cancelPress();
    if (sheet) closeSheet();
    if (editing) { editing = false; render(); }
  },
};
export default app;
