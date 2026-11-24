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

/** The list without the notice that arrived at `at`. Other notices keep their order. */
export function withoutNotice<T extends GroupableNotice>(list: readonly T[], at: number): T[] {
  return list.filter(n => n.at !== at);
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
