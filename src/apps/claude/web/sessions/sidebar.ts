// The Sessions screen's left sidebar, like the Claude desktop app's Code tab: every session on the PC
// grouped under its folder (a small header with a chevron that folds the group), newest first, each
// with a dot for its state (clay pulsing = working, blue = your turn, grey = quiet or past), the open
// one highlighted. A search field at the top filters by title; "Show older" pages back per folder.
// Live state comes from the usage poll; the past comes from sessions/history.ts. The list's data (groups,
// dots, times) is in sessions/sidebar-groups.ts; this file draws it.
import { $, esc, report, store } from '../../../../core/web/dom.ts';
import { Keyboard } from '../../../../core/web/keyboard.ts';
import type { LiveSession } from '../../api.ts';
import { archiveEmpty, emptyText, folded, folderLive, groups, isLive, stateOf, when, type Row } from './sidebar-groups.ts';
import { historyArchivedView, historyFailed, historyLoading, historyNow, historyQuery, historyTick, loadOlder, onHistoryChange, setQuery } from './history.ts';

export { historyTitle } from './history.ts';

const QUIET_FOLD_DAYS = 14;        // folders untouched this long start folded
const MAX_ROWS = 400;              // never draw more than this many rows

// fold state: explicit choices per folder name (older builds kept a plain list of folded names)
const KEY = 'claude.sb.fold';
const choice = new Map<string, boolean>((() => {
  try {
    const v = JSON.parse(store.get(KEY) || 'null') as [string, boolean][] | null;
    if (v) return v;
    return (JSON.parse(store.get('claude.sb.folded') || '[]') as string[]).map(n => [n, true] as [string, boolean]);
  } catch { return []; }
})());

let shutNow = new Map<string, boolean>();   // as last drawn, so a tap flips what you see
export function toggleFolder(key: string): void {
  choice.set(key, !(shutNow.get(key) ?? false));
  store.set(KEY, JSON.stringify([...choice]));
}

const CHEV = '<svg class="sb-chev" viewBox="0 0 12 12"><path d="M4 2.5 7.5 6 4 9.5"/></svg>';

const DOTS = '<svg viewBox="0 0 16 16"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg>';

function rowHtml(r: Row, openId: string | null, waitingOk: ReadonlySet<string>): string {
  let cls = '', what: string;
  if (r.live && (isLive(r.live) || !r.item)) ({ cls, what } = stateOf(r.live, Date.now(), waitingOk));
  else {
    const i = r.item!;
    what = `${i.open ? 'On your PC · ' : ''}${when(r.at)}${i.messages ? ` · ${i.messages} message${i.messages === 1 ? '' : 's'}` : ''}`;
  }
  // a div, not a button: the ⋯ inside it is a button of its own (its actions: reply.ts / manage.ts)
  return `<div class="sb-row ${cls}${r.id === openId ? ' on' : ''}" data-id="${esc(r.id)}" role="button" tabindex="0"><i class="dot"></i>`
    + `<span class="sb-name">${esc(r.title)}</span><span class="sb-what">${esc(what)}</span>`
    + `<button class="sb-more" data-menu="${esc(r.id)}" data-title="${esc(r.title)}" data-arch="${historyArchivedView() ? 1 : 0}" aria-label="Session actions">${DOTS}</button></div>`;
}

/**
 * The sidebar's list. Groups are ordered by their most recent session; a folder holding the open
 * session is never folded away from view, and searching shows every match unfolded.
 */
export function sidebarHtml(list: LiveSession[], openId: string | null, waitingOk: ReadonlySet<string> = new Set()): string {
  historyTick();
  const q = historyQuery(), now = Date.now();
  const gs = groups(list, now, historyNow(), q, historyArchivedView());
  if (!gs.length) {
    if (q) return `<div class="sb-empty">No sessions match “${esc(q)}”.</div>`;
    if (historyArchivedView()) { const a = archiveEmpty(historyFailed(), !!historyNow()); return `<div class="sb-empty">${a.head}${a.tip ? `<br>${a.tip}` : ''}</div>`; }
    if (historyFailed()) return `<div class="sb-empty">${emptyText(true)}.</div>`;
    return historyNow() || !historyLoading() ? `<div class="sb-empty">${emptyText(false)}.<br>Start one with New session.</div>` : '<div class="sb-empty">Loading sessions…</div>';
  }
  let html = '', rows = 0;
  shutNow = new Map();
  for (const g of gs) {
    const has = g.rows.some(r => r.id === openId);
    const quiet = now - g.latest > QUIET_FOLD_DAYS * 864e5;
    const shut = !q && !has && folded(choice, g, quiet);
    shutNow.set(g.key, shut);
    const live = folderLive(g);   // "2 working · 1 waiting"
    html += `<button class="sb-folder${shut ? ' shut' : ''}" data-folder="${esc(g.key)}">${CHEV}<span class="label">${esc(g.name)}</span>`
      + `<em>${shut || g.count > 1 ? g.count : ''}${live ? ` · ${live}` : ''}</em></button>`;
    if (shut) continue;
    for (const r of g.rows) {
      if (rows >= MAX_ROWS && r.id !== openId) continue;
      html += rowHtml(r, openId, waitingOk); rows++;
    }
    if (g.more && g.id && rows < MAX_ROWS) {
      const left = g.count - g.rows.length;
      html += `<button class="sb-older" data-older="${esc(g.id)}">Show older${left > 0 ? ` <em>${left}</em>` : ''}</button>`;
    }
  }
  return html;
}

// ---------- search and paging ----------
function paintSearch(): void {
  const q = historyQuery();
  $('svSearchText').textContent = q || 'Search sessions';
  $('svSearch').classList.toggle('set', !!q);
  $('svSearchClear').hidden = !q;
}

function openSearch(): void {
  const before = historyQuery();
  let timer: number | undefined;
  $('svSearch').classList.add('typing');
  Keyboard.open({
    value: before, placeholder: 'Search sessions', done: 'Search', max: 60,
    onChange: text => { clearTimeout(timer); timer = window.setTimeout(() => { setQuery(text); paintSearch(); }, 250); },
    onDone: text => { clearTimeout(timer); setQuery(text); paintSearch(); },
    onClose: reason => {
      clearTimeout(timer);
      $('svSearch').classList.remove('typing');
      if (reason === 'cancel') { setQuery(before); paintSearch(); }
    },
  });
  report('sessions-search');
}

/** Wire the search field and "Show older". `repaint` redraws the list (reply.ts owns when). */
export function initSidebar(repaint: () => void): void {
  onHistoryChange(repaint);
  paintSearch();
  $('svSearch').addEventListener('click', e => {
    if ((e.target as Element).closest('#svSearchClear')) {
      if (Keyboard.isOpen) Keyboard.close('close');
      setQuery(''); paintSearch(); return;
    }
    openSearch();
  });
  $('svList').addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-older]');
    if (!b || b.classList.contains('busy')) return;
    b.classList.add('busy'); b.textContent = 'Loading…';
    void loadOlder(b.dataset.older!);
    report('sessions-older');
  });
}
