// Every past session on the PC, for the sidebar: fetched by folder from /api/claude/history,
// newest few per folder first, older ones a page at a time ("Show older"), filtered by the search.
import { getJson } from '../../../../core/web/dom.ts';
import type { History, HistoryGroup } from '../../api.ts';

const STALE_MS = 30e3;
let data: History | null = null;
let fetchedAt = 0, loading = false, gen = 0;
let failed = false;                  // the last history fetch failed (the PC did not answer)
let query = '';
let archivedView = false;            // the sidebar shows the archived sessions instead of the rest
let onChange: () => void = () => {};

export const historyNow = (): History | null => data;
export const historyQuery = (): string => query;
export const historyLoading = (): boolean => loading;
export const historyFailed = (): boolean => failed;
export const historyArchivedView = (): boolean => archivedView;
export const historyArchivedCount = (): number => data?.archived ?? 0;
export function onHistoryChange(fn: () => void): void { onChange = fn; }

const url = (p: Record<string, string | number>) =>
  '/api/claude/history?' + new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString();
const scope = (): Record<string, number> => (archivedView ? { archived: 1 } : {});

/** Switch between the sessions and the archived ones (the list is fetched again). */
export function setArchivedView(on: boolean): void {
  if (on === archivedView) return;
  archivedView = on;
  data = null;
  void loadHistory();
}

/** Fetch the first page of every folder again, keeping older pages already shown. */
export async function loadHistory(): Promise<void> {
  const my = ++gen, q = query;
  loading = true;
  let fresh: History;
  try { fresh = await getJson<History>(url({ q, ...scope() })); } catch { failed = true; loading = false; onChange(); return; } finally { fetchedAt = Date.now(); }
  failed = false;
  if (my !== gen) return;   // a newer search went out meanwhile
  loading = false;
  if (data && data.q === fresh.q) {
    for (const g of fresh.groups) {
      const prev = data.groups.find(x => x.id === g.id);
      if (!prev || prev.items.length <= g.items.length) continue;
      const have = new Set(g.items.map(i => i.id)), lastAt = g.items[g.items.length - 1]?.at || '';
      const older = prev.items.filter(i => !have.has(i.id) && i.at < lastAt);
      g.items.push(...older);
      g.more = prev.more || g.count > g.items.length;
    }
  }
  data = fresh;
  onChange();
}

/** Keep the list current while the Sessions screen is up (called whenever the sidebar paints). */
export function historyTick(): void {
  if (!loading && Date.now() - fetchedAt > STALE_MS) void loadHistory();
}

export function setQuery(q: string): void {
  q = q.trim();
  if (q === query) return;
  query = q;
  void loadHistory();
}

/** The next page of one folder. */
export async function loadOlder(folderId: string): Promise<void> {
  const g: HistoryGroup | undefined = data?.groups.find(x => x.id === folderId);
  if (!g || !g.more) return;
  const last = g.items[g.items.length - 1];
  let r: History;
  try { r = await getJson<History>(url({ q: query, ...scope(), folder: folderId, before: last?.at || '', limit: 25 })); } catch { onChange(); return; }
  const page = r.groups[0];
  const cur = data?.groups.find(x => x.id === folderId);
  if (!cur || !page) { if (cur) { cur.more = false; onChange(); } return; }
  const have = new Set(cur.items.map(i => i.id));
  cur.items.push(...page.items.filter(i => !have.has(i.id)));
  cur.more = page.more;
  onChange();
}

export function historyTitle(id: string): string | null {
  for (const g of data?.groups || []) for (const i of g.items) if (i.id === id) return i.title;
  return null;
}
