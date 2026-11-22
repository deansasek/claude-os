// The Apps screen's saved layout, shared by the page (web/index.ts) and the PC (server/layout.ts).
//
// One layout per screen: the tablet and the Nest Hub ('hub') arrange their own. A layout is the order of the tiles
// and the tiles hidden from the grid. Each tile has a key:
//   c:<appId>     one of ClaudeOS's own apps (src/apps/<appId>)
//   a:<package>   an Android app the user allowed on the tablet (Launcher.java keeps that list; the layout only orders it)
export type LauncherScreen = 'tablet' | 'hub';
export interface LauncherLayout { order: string[]; hidden: string[] }
/** What GET and POST /api/launcher/layout answer. layout is null when the PC has none saved for that screen yet. */
export interface LauncherLayoutResult { ok: boolean; screen: LauncherScreen; layout: LauncherLayout | null; error?: string }

export const LAYOUT_MAX_BYTES = 16 * 1024;   // a POST bigger than this is refused (413)
export const MAX_KEYS = 200;                 // tiles in one list, at most
export const OWN_KEY = /^c:[a-z0-9][a-z0-9-]{0,39}$/;
export const ANDROID_KEY = /^a:[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const MAX_PACKAGE = 255;

export const isScreen = (v: unknown): v is LauncherScreen => v === 'tablet' || v === 'hub';
/** A key of the right shape (says nothing about whether that app exists). */
export const isKey = (k: unknown): k is string =>
  typeof k === 'string' && (OWN_KEY.test(k) || (k.length <= MAX_PACKAGE + 2 && ANDROID_KEY.test(k)));

export interface CleanOptions {
  /** ClaudeOS app ids that exist; any other c: key is dropped. Omitted: every well-formed c: key is kept. */
  own?: ReadonlySet<string>;
  /** Packages allowed on the tablet now; any other a: key is dropped. Omitted: every well-formed a: key is kept
   *  (the PC can't see the tablet's list, so it never drops an Android key on its own). */
  allowed?: ReadonlySet<string>;
  /** No Android keys at all (the Nest Hub has no Android apps). */
  noAndroid?: boolean;
  /** Refuse (null) a layout with a key of the wrong shape, instead of dropping that key. */
  strict?: boolean;
}

/**
 * A clean copy of a layout, or null when it isn't one. Keys must be "c:<appId>" or "a:<package>"; each is kept once
 * (first place wins), keys of unknown apps are dropped, and hidden keeps only keys that pass the same rules.
 */
export function cleanLayout(raw: unknown, opts: CleanOptions = {}): LauncherLayout | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  for (const k of ['order', 'hidden'] as const) {
    if (r[k] === undefined || !opts.strict) continue;   // read leniently: a list that isn't one counts as empty
    if (!Array.isArray(r[k])) return null;
    if ( ((r[k] as unknown[]).length > MAX_KEYS || !(r[k] as unknown[]).every(isKey))) return null;
  }
  const keep = (k: string): boolean => {
    if (k.startsWith('c:')) return !opts.own || opts.own.has(k.slice(2));
    if (opts.noAndroid) return false;
    return !opts.allowed || opts.allowed.has(k.slice(2));
  };
  const list = (a: unknown): string[] => {
    const seen = new Set<string>(), out: string[] = [];
    for (const k of Array.isArray(a) ? a : []) {
      if (out.length >= MAX_KEYS) break;
      if (!isKey(k) || seen.has(k) || !keep(k)) continue;
      seen.add(k); out.push(k);
    }
    return out;
  };
  return { order: list(r.order), hidden: list(r.hidden) };
}
