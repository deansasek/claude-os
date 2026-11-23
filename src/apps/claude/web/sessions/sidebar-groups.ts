// The Sessions sidebar's list as data (sessions/sidebar.ts draws it): which sessions are live, the dot and the few
// words for each, the time words, and the folder groups with the live sessions laid over the history. Pure: the
// clock (now) and the history come in as arguments, so this runs in node (test/sidebar-groups.test.ts).
import { clock, shortAge } from '../../../../core/web/format.ts';
import type { History, HistoryItem, LiveSession } from '../../api.ts';
import { toolWord } from '../words.ts';

export const LIVE_S = 30 * 60;

/** A session counts as live here while it's recent, open on the PC, or one Claude Home started. */
export const isLive = (s: LiveSession): boolean => s.age < LIVE_S || s.open || s.hub;

/** "12m ago", "Today 2:14 PM", "Yesterday", "Tue", "Mar 3", "Mar 3, 2025", as of `now` (ms). */
export function when(at: number, now = Date.now()): string {
  const d = new Date(at), n = new Date(now), mins = (now - at) / 60e3;
  if (mins < 60) return `${Math.max(1, Math.round(mins))}m ago`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(n) - day(d)) / 864e5);
  if (days === 0) return `Today ${clock(d)}`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== n.getFullYear() ? { year: 'numeric' } : {}) });
}

/** Which dot a session gets, and the few words under its title, as of `now` (ms). */
export function stateOf(s: LiveSession, now = Date.now()): { cls: string; what: string } {
  if (s.state === 'thinking' || s.state === 'tool') return { cls: 'busy', what: s.state === 'tool' ? toolWord(s.tool) : 'Thinking' };
  if (s.state === 'waiting' && isLive(s)) return { cls: 'yours', what: s.open ? `Your turn · on your PC` : `Your turn · ${shortAge(s.age)}` };
  if (!isLive(s)) return { cls: '', what: when(now - s.age * 1000, now) };
  return { cls: '', what: `${s.open ? 'On your PC' : 'Quiet'} · ${shortAge(s.age)}` };
}

export interface Row { id: string; title: string; at: number; live: LiveSession | null; item: HistoryItem | null }
export interface Group { key: string; id: string | null; name: string; rows: Row[]; count: number; more: boolean; latest: number }

/** The folder groups, newest first. The history's groups come first, each session shown with its live state when it is
 *  live. Live sessions the history has not caught up with are added (not while searching, or in the archive).
 *  `now` is the clock (ms); `h` the history as last loaded; `q` the search; `archived` the archive view. */
export function groups(list: LiveSession[], now: number, h: History | null, q: string, archived: boolean): Group[] {
  const live = new Map<string, LiveSession>();
  for (const s of list) if (s.id) live.set(s.id, s);
  const out: Group[] = [];
  const byKey = new Map<string, Group>();
  const placed = new Set<string>();
  for (const g of h?.groups || []) {
    const grp: Group = { key: g.name, id: g.id, name: g.name, count: g.count, more: g.more, latest: Date.parse(g.latest), rows: [] };
    for (const i of g.items) {
      const l = live.get(i.id) || null;
      const at = l && isLive(l) ? now - l.age * 1000 : Date.parse(i.at);
      grp.rows.push({ id: i.id, title: l?.title || i.title, at, live: l, item: i });
      placed.add(i.id);
    }
    out.push(grp); byKey.set(g.id, grp); byKey.set('n:' + g.name, grp);
  }
  // live sessions the history hasn't caught up with yet (or before it has loaded); not while searching or in the archive
  if (!q && !archived) {
    for (const s of live.values()) {
      if (placed.has(s.id!)) continue;
      let grp = (s.folderId && byKey.get(s.folderId)) || byKey.get('n:' + s.folder);
      if (!grp) {
        grp = { key: s.folder, id: null, name: s.folder, count: 0, more: false, latest: 0, rows: [] };
        out.push(grp); byKey.set('n:' + s.folder, grp); if (s.folderId) byKey.set(s.folderId, grp);
      }
      grp.rows.push({ id: s.id!, title: s.title, at: now - s.age * 1000, live: s, item: null });
      grp.count++;
    }
  }
  for (const g of out) {
    g.rows.sort((a, b) => b.at - a.at);
    g.latest = Math.max(g.latest, g.rows[0]?.at || 0);
  }
  return out.sort((a, b) => b.latest - a.latest);
}
