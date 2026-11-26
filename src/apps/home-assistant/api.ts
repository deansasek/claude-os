// Shapes of what the Home Assistant app's server routes send to its page, and the domain rules both sides use.
// Served to the browser: nothing secret lives here (the address and token stay in .ha-config.json on the PC).

/** The only kinds of device ClaudeOS (and Claude) may switch. */
export const CONTROL_DOMAINS = ['light', 'switch', 'media_player', 'fan', 'climate'] as const;
export type ControlDomain = typeof CONTROL_DOMAINS[number];

/** Never called, from the page or from Claude's tools: locks, alarms, doors and anything that runs code. */
export const DENIED_DOMAINS = ['lock', 'alarm_control_panel', 'cover', 'script', 'automation', 'homeassistant', 'hassio'] as const;

/** Shown on the dashboard read-only (a state, never a switch). Covers are here and also in DENIED_DOMAINS. */
export const READ_ONLY_DOMAINS = ['cover', 'sensor', 'binary_sensor'] as const;

/** What voice may switch on or off without Claude ("turn off the kitchen light"): a subset of CONTROL_DOMAINS. */
export const VOICE_DOMAINS = ['light', 'switch', 'fan', 'media_player'] as const;
export const isVoiceDomain = (d: string): boolean => (VOICE_DOMAINS as readonly string[]).includes(d);

export const isControlDomain =(d: string): d is ControlDomain => (CONTROL_DOMAINS as readonly string[]).includes(d);
export const isDeniedDomain = (d: string): boolean => (DENIED_DOMAINS as readonly string[]).includes(d);
export const isReadOnlyDomain = (d: string): boolean => (READ_ONLY_DOMAINS as readonly string[]).includes(d);

/** Scenes: a saved set of device states. The only thing ever called on one is scene.turn_on (ha.ts activateScene). */
export const SCENE_DOMAIN = 'scene';
export const isSceneDomain = (d: string): boolean => d === SCENE_DOMAIN;
/** At most this many scenes on the Home screen's quick actions. */
export const MAX_HOME_SCENES = 3;

/** May show on the dashboard: the controllable kinds, scenes, and the read-only ones. Never locks, alarms, scripts... */
export const isShownDomain = (d: string): boolean => isControlDomain(d) || isSceneDomain(d) || isReadOnlyDomain(d);

/** A Home Assistant entity id, e.g. "light.kitchen". */
export const ENTITY_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;

/** Whether a device counts as "on" for its tile. */
export function isOn(domain: string, state: string): boolean {
  if (domain === 'media_player') return ['on', 'playing', 'paused', 'idle', 'buffering'].includes(state);
  if (domain === 'climate') return state !== 'off' && state !== 'unavailable' && state !== 'unknown';
  if (!isControlDomain(domain)) return false;
  return state === 'on';
}

/** A climate mode in plain words. Unknown modes get their own name, spaced and capitalised, never a raw domain name. */
export function climateLabel(state: string): string {
  switch (state) {
    case 'heat': return 'Heating';
    case 'cool': return 'Cooling';
    case 'auto':
    case 'heat_cool': return 'Auto';
    case 'dry': return 'Drying';
    case 'fan_only': return 'Fan only';
  }
  const words = state.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface HaEntity {
  entity_id: string;            // "light.kitchen"
  domain: string;               // a control domain, or a read-only one (cover, sensor, binary_sensor)
  name: string;                 // friendly name
  state: string;                // as Home Assistant says it: on, off, playing, heat, unavailable...
  on: boolean;
  readonly?: boolean;           // shown only: covers and sensors
  current?: number;             // climate: the room temperature
  target?: number;              // climate: the set temperature
  unit?: string;                // climate: "°C"; sensor: its unit of measurement
  media?: string;               // media_player: what is playing
  deviceClass?: string;         // sensor, binary_sensor, cover: temperature, humidity, door, motion...
  missing?: boolean;            // on the dashboard, but Home Assistant didn't report it
}

export interface HaStatus {
  configured: boolean;          // an address and a token are saved
  demo: boolean;                // the made-up house: only under CLAUDEOS_HA_DEMO=1 (tests); the page does not read it
  connected: boolean | null;    // the last call to Home Assistant worked; null when none was made yet (or in demo)
  address: string;              // the saved address (never the token)
  token: string;                // the token masked, e.g. "••••3f9a", or "" when none is saved
  error?: string;               // why the last call failed
}

/** The allowlisted (Claude) devices and their state. */
// status "not_set_up": no address or token saved yet; error says where to add them (Settings).
export interface HaEntities { status: 'ok' | 'error' | 'not_set_up'; demo: boolean; entities: HaEntity[]; error?: string }

/** Every device Home Assistant reports that may show on the dashboard; `allowed` is Claude's allowlist only. */
export interface HaDevice {
  entity_id: string; name: string; domain: string;
  allowed: boolean;             // on Claude's allowlist (Settings)
  controllable: boolean;        // a control domain: may be switched (and allowed for Claude)
  dashboard: boolean;           // shown on the Home dashboard
}
export interface HaDevices { status: 'ok' | 'error' | 'not_set_up'; demo: boolean; devices: HaDevice[]; error?: string }

// ---------- the dashboard layout (.ha-layout.json on the PC; one for the demo house, one for the real one) ----------
export interface HaRoom { id: string; name: string; devices: string[] }
export interface HaLayout {
  rooms: HaRoom[];              // in order; each room's devices in order
  other: string[];              // on the dashboard but in no room ("Other")
  names: Record<string, string>;   // custom names, by entity id
  /** The scenes on the Home screen's quick actions (up to MAX_HOME_SCENES), in order. Absent: the default
   *  (both demo scenes in the demo house, none in the real one). */
  homeScenes?: string[];
}

// ---------- scenes ----------
export interface HaScene {
  entity_id: string;            // "scene.movie_night"
  name: string;                 // the custom name from the layout, else Home Assistant's friendly name
  dashboard: boolean;           // placed on the Home Assistant app's dashboard
  home: boolean;                // one of the Home screen's quick actions
}
/** GET scenes: every scene Home Assistant reports, and the Home screen's picks in order. */
export interface HaScenes { status: 'ok' | 'error' | 'not_set_up'; demo: boolean; scenes: HaScene[]; home: string[]; error?: string }
export interface HaHomeScenesResult { ok: boolean; home: string[]; error?: string }
/** GET layout: the layout, and the state of every device on it. */
export interface HaDashboard { status: 'ok' | 'error' | 'not_set_up'; demo: boolean; layout: HaLayout; entities: HaEntity[]; error?: string }
export interface HaLayoutResult { ok: boolean; layout: HaLayout; error?: string }

export const MAX_ROOMS = 30;
export const MAX_ROOM_NAME = 40;
export const MAX_DEVICE_NAME = 60;
/** Room ids: "r" and a few letters or digits. */
export const ROOM_ID = /^r[a-z0-9]{1,23}$/;

export interface HaConfigUpdate { address?: string; token?: string }
export interface HaResult { ok: boolean; error?: string; entity?: HaEntity }
export interface HaTestResult { ok: boolean; message: string }
