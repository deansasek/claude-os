// The notification shade's grouping rules (system.ts draws them). Pure: no DOM and no imports, so the test runs under node.

/** A notice as the shade keeps it: the app that sent it, when it arrived, and a key to find it again. */
export interface GroupableNotice { app?: string; at: number }

/** The notices of one app, newest first. `latest` is the newest arrival time, which orders the groups. */
export interface NoticeGroup<T extends GroupableNotice> { app: string; items: T[]; latest: number }

/**
 * Group notices by the app that sent them. Newest group first. Notices with no app form the group named ''.
 * The order inside a group is kept (the input is newest first, so each group is too).
 */
export function groupNotices<T extends GroupableNotice>(list: readonly T[]): NoticeGroup<T>[] {
  const byApp = new Map<string, NoticeGroup<T>>();
  for (const n of list) {
    const app = n.app || '';
    const g = byApp.get(app) ?? { app, items: [], latest: 0 };
    g.items.push(n);
    g.latest = Math.max(g.latest, n.at);
    byApp.set(app, g);
  }
  return [...byApp.values()].sort((a, b) => b.latest - a.latest);
}

/**
 * The arrival time for a new notice. It is `now`, or one millisecond after the newest notice when that notice
 * has the same time. Notices sent in the same millisecond then keep unique times, so dismissing one keeps the other.
 * The list is newest first.
 */
export function nextNoticeAt(list: readonly GroupableNotice[], now: number): number {
  return Math.max(now, (list[0]?.at ?? 0) + 1);
}

/** The list without the notice that arrived at `at`. Other notices keep their order. */
export function withoutNotice<T extends GroupableNotice>(list: readonly T[], at: number): T[] {
  return list.filter(n => n.at !== at);
}

/** A saved notice as the shade reads it: a title and a time, and the optional text, app and icon when they are strings. */
export interface SavedNotice extends GroupableNotice { title: string; body?: string; app?: string; icon?: string }

/** The saved notices, newest first, at most 30. A bad entry (not an object, no title, no time) is dropped, and one bad value cannot stop every notification. */
export function parseNotices(raw: string | null | undefined): SavedNotice[] {
  let v: unknown;
  try { v = JSON.parse(raw || '[]'); } catch { return []; }
  if (!Array.isArray(v)) return [];
  const out: SavedNotice[] = [];
  for (const x of v) {
    if (typeof x !== 'object' || x === null) continue;
    const n = x as Record<string, unknown>;
    if (typeof n.title !== 'string' || typeof n.at !== 'number' || !Number.isFinite(n.at)) continue;
    const notice: SavedNotice = { title: n.title, at: n.at };
    if (typeof n.body === 'string') notice.body = n.body;
    if (typeof n.app === 'string') notice.app = n.app;
    if (typeof n.icon === 'string') notice.icon = n.icon;
    out.push(notice);
    if (out.length >= 30) break;
  }
  return out;
}

/** The muted apps, read from the saved text (a JSON array of app ids). Anything else reads as none. */
export function parseMutedApps(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))] : [];
  } catch { return []; }
}

/** The muted list after one app is muted or unmuted. */
export function toggleMutedApp(muted: readonly string[], app: string): string[] {
  return muted.includes(app) ? muted.filter(a => a !== app) : [...muted, app];
}

/** A short name for an app id in a group heading: "home-assistant" reads "Home assistant". */
export function appLabel(app: string): string {
  if (!app) return 'Other';
  const words = app.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
