// The Apps screen search (index.ts): finds apps, Settings rows, list names and items, and Claude sessions by name.
// Pure: no DOM and no imports, so the test runs under node. The sources are passed in by the caller.

export type HitKind = 'app' | 'setting' | 'list' | 'item' | 'recipe' | 'session';

/** One result. `ref` is what the caller opens: an app tile key, a Settings section, a list id, or a session id. */
export interface Hit { kind: HitKind; label: string; sub: string; ref: string }

export interface SearchSources {
  apps: { key: string; name: string }[];                       // tile keys as the grid has them ("c:photos", "a:com.x")
  lists: { id: string; name: string; items: string[] }[];
  sessions: { id: string; title: string; folder: string }[];
  recipes?: { name: string }[];                                  // saved recipes (the Recipes app's list), found by name
  onTablet?: boolean;                                            // false on a Hub: the tablet-only Settings sections are not offered (default true)
}

/** Settings sections that only the tablet shows (Settings hides them on other screens: a hit there would open nothing). */
const TABLET_ONLY_SECTIONS = new Set(['wifi', 'google', 'bluetooth', 'display', 'sound', 'battery', 'keyboard', 'apps', 'storage', 'datetime', 'security', 'developer']);

/** The Settings sections a search can open (the names the Settings nav shows). */
export const SETTINGS_ROWS: { section: string; label: string }[] = [
  { section: 'profile', label: 'Profile' }, { section: 'usage', label: 'Usage' }, { section: 'yourclaude', label: 'Your Claude' },
  { section: 'sessions', label: 'Sessions' }, { section: 'plugins', label: 'Plugins' }, { section: 'voice', label: 'Voice' },
  { section: 'notifications', label: 'Notifications' }, { section: 'wifi', label: 'Wi-Fi' }, { section: 'google', label: 'Google account' },
  { section: 'bluetooth', label: 'Bluetooth' }, { section: 'display', label: 'Display' }, { section: 'appearance', label: 'Appearance' },
  { section: 'sound', label: 'Sound' }, { section: 'battery', label: 'Battery' }, { section: 'keyboard', label: 'Keyboard' },
  { section: 'apps', label: 'Apps' }, { section: 'storage', label: 'Storage' }, { section: 'datetime', label: 'Date and time' },
  { section: 'privacy', label: 'Privacy' }, { section: 'wellbeing', label: 'Wellbeing' }, { section: 'security', label: 'Security' },
  { section: 'about', label: 'About' }, { section: 'developer', label: 'Developer' }, { section: 'monitor', label: 'System monitor' },
];

/** Lower case, no apostrophes, single spaces: so "Wi‑Fi", "wi-fi" and "Don’t" compare the same way. */
export const normalize = (s: string): string => s.toLowerCase().replace(/[’'‘]/g, '').replace(/[-‐‑]/g, ' ').replace(/\s+/g, ' ').trim();

/** How well `text` matches `query`: 3 when it starts with it, 2 when a word does, 1 when it contains it, 0 when not. */
export function score(query: string, text: string): number {
  const q = normalize(query), t = normalize(text);
  if (!q || !t) return 0;
  if (t.startsWith(q)) return 3;
  if (t.split(' ').some(w => w.startsWith(q))) return 2;
  if (t.includes(q)) return 1;
  // Compare without spaces too, so "wifi" finds "Wi-Fi" (normalized to "wi fi").
  const qj = q.replace(/ /g, ''), tj = t.replace(/ /g, '');
  if (tj.startsWith(qj)) return 3;
  return tj.includes(qj) ? 1 : 0;
}

const KIND_ORDER: Record<HitKind, number> = { app: 0, setting: 1, list: 2, item: 3, recipe: 4, session: 5 };
const MAX_HITS = 30;

/**
 * Every match for `query`, best first: a better match ranks higher, and ties keep apps, then Settings, lists, list items
 * and sessions. An empty query finds nothing.
 */
export function searchAll(query: string, src: SearchSources): Hit[] {
  if (!normalize(query)) return [];
  const found: (Hit & { s: number })[] = [];
  const add = (kind: HitKind, label: string, sub: string, ref: string, text = label): void => {
    const s = score(query, text);
    if (s) found.push({ kind, label, sub, ref, s });
  };
  for (const a of src.apps) add('app', a.name, 'App', a.key);
  for (const r of SETTINGS_ROWS) {
    if (src.onTablet === false && TABLET_ONLY_SECTIONS.has(r.section)) continue;
    add('setting', r.label, 'Settings', r.section);
  }
  for (const l of src.lists) {
    add('list', l.name, 'List', l.id);
    for (const it of l.items) add('item', it, `In ${l.name}`, l.id, it);
  }
  for (const s of src.sessions) add('session', s.title || 'Claude session', s.folder || 'Claude', s.id, `${s.title} ${s.folder}`);
  for (const r of src.recipes ?? []) add('recipe', r.name, 'Recipe', r.name);
  found.sort((a, b) => (b.s - a.s) || (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]));
  return found.slice(0, MAX_HITS).map(({ kind, label, sub, ref }) => ({ kind, label, sub, ref }));
}
