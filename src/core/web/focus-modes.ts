// Focus modes (Work, Family, Sleep): one tap sets the notifications and which apps show, together. Each mode has a
// control center tile (system.ts). Modes do not change routines. Pure: no DOM and no imports, so the test runs under node.

export type FocusId = 'work' | 'family' | 'sleep';

export interface FocusMode {
  id: FocusId;
  name: string;
  dnd: boolean;       // Do Not Disturb on: no chimes, speech or banners
  banners: boolean;   // banners on (ignored while Do Not Disturb is on)
  chimes: boolean;    // chimes on
  hide: string[];     // app ids that leave the rail and the Apps screen while the mode is on
}

export const FOCUS_MODES: readonly FocusMode[] = [
  { id: 'work', name: 'Work', dnd: false, banners: true, chimes: false, hide: ['photos', 'home-assistant', 'radio'] },
  { id: 'family', name: 'Family', dnd: false, banners: true, chimes: true, hide: ['browser', 'routines'] },
  { id: 'sleep', name: 'Sleep', dnd: true, banners: false, chimes: false, hide: ['browser', 'photos', 'home-assistant', 'calendar', 'radio'] },
];

/** These never leave the rail or the Apps screen, whatever a mode says. */
export const ALWAYS_SHOWN = ['home', 'claude', 'settings', 'launcher'];

/** The mode with this id, or null (no mode, or an unknown id). */
export function focusMode(id: string | null | undefined): FocusMode | null {
  return FOCUS_MODES.find(m => m.id === id) ?? null;
}

/**
 * The stored settings a mode sets, as store writes: null removes a key. Turning focus off (id null) puts the
 * notifications back on and shows every app. Keys: os.dnd, os.banners, os.chimes, os.focusApps, os.focusMode.
 */
export function modeSettings(id: string | null): Record<string, string | null> {
  const m = focusMode(id);
  if (!m) return { 'os.dnd': '0', 'os.banners': '1', 'os.chimes': '1', 'os.focusApps': null, 'os.focusMode': null };
  return {
    'os.dnd': m.dnd ? '1' : '0',
    'os.banners': m.banners ? '1' : '0',
    'os.chimes': m.chimes ? '1' : '0',
    'os.focusApps': JSON.stringify(m.hide.filter(a => !ALWAYS_SHOWN.includes(a))),
    'os.focusMode': m.id,
  };
}

/** The app ids a focus mode hides, read from the saved text (a JSON array). Anything else hides none. */
export function hiddenApps(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !ALWAYS_SHOWN.includes(x)) : [];
  } catch { return []; }
}
