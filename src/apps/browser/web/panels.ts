// The Browser's panels, drawn over the content area: the menu, the find bar, full pages (history, bookmarks,
// downloads, reader view, tab overview), the sheets (long-press choices, uploads, Claude Home photos, site
// permission asks). While one of them is on (an element with class br-over.on, or the find bar), the native
// page is hidden: index.ts sync() takes care of that.
import { esc, getJson, store } from '../../../core/web/dom.ts';
import type { AppContext } from '../../../core/web/shell.ts';
import { browser, voice, type BrowserEvent } from '../../../core/web/device.ts';
import { openApp } from '../../../core/web/system.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import { askWithText } from '../../claude/web/reply.ts';
import { askAboutPage } from './claude-panel.ts';
import { thumbUrl } from '../../photos/api.ts';
import type { PhotoList } from '../../photos/api.ts';
import {
  I, S, PERM_KINDS, host, liveOf, cur, ago, dayOf, size, isBookmarked, savePerms, saveBookmarks,
  saveDownloads, saveTabs, saveHistory, MAX_BOOK, MAX_TABS, type Bookmark, type Dl, type Tab, type PermKind,
} from './state.ts';

interface PanelDeps {
  ctx: AppContext;
  sel(): Tab;                                   // the current tab
  open(url: string, id?: string): void;         // load url in a tab (default: the current one)
  newTab(url?: string, priv?: boolean): Tab | null;
  select(id: string): void;
  closeTab(id: string): void;
  flash(text: string): void;
  render(): void;                               // bar, tabs and content
  sync(): void;                                 // the native page's visibility, after an overlay changes
  notify(title: string, body: string): void;
  shown(): boolean;                             // the Browser is on screen
}

let D!: PanelDeps;
const el = <T extends HTMLElement = HTMLElement>(id: string): T => D.ctx.$<T>(id);

// ---------- overlays ----------
function openOver(id: string): void { el(id).classList.add('on'); D.sync(); }
/** Takes an overlay down without any answer to a waiting upload (used when one page replaces another). */
function hideOver(id: string): void { el(id).classList.remove('on'); }
function closeOver(id: string): void {
  const e = el(id);
  if (!e.classList.contains('on')) return;
  if (id === 'brPerm') {                       // leaving the sheet any way (outside tap, Back) is "Not now"
    if (asks.length) answerAsk(false, null);
    else { e.classList.remove('on'); D.sync(); }
    return;
  }
  if (id === 'brDialog') {                     // leaving a page's dialog any way is "Cancel" (alerts: OK)
    if (dialogs.length) answerDialog(false);
    else { e.classList.remove('on'); D.sync(); }
    return;
  }
  if ((id === 'brChoose' || id === 'brPhotos') && chooser) { const c = chooser; chooser = null; browser.chooseFile(c.tab, 'cancel'); }
  e.classList.remove('on');
  D.sync();
}

// ---------- the menu ----------
// `on` marks a setting row (Desktop site): it shows a switch instead of a meta text.
interface MenuItem { act: string; icon: string; label: string; meta?: string; disabled?: boolean; on?: boolean }

function openMenu(): void {
  const t = D.sel(), has = !!t.url, l = liveOf(t.id), bm = isBookmarked(t.url);
  // groups, separated by a thin line: this page, sharing it, tabs, the saved lists
  const groups: MenuItem[][] = [
    [
      { act: 'bookmark', icon: I.star, label: bm ? 'Remove bookmark' : 'Bookmark this page', disabled: !has },
      { act: 'find', icon: I.find, label: 'Find in page', disabled: !has },
      { act: 'reader', icon: I.reader, label: 'Reader view', disabled: !has },
      { act: 'translate', icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h8M7 3v2M5 5c.6 2.4 2.2 4.2 4.5 5.4M10.5 16l2.5-6 2.5 6M11.4 13.5h2.2"/></svg>', label: 'Translate with Claude', disabled: !has },
      { act: 'listen', icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8v4h3l4 3V5l-4 3z"/><path d="M13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5.5a6.5 6.5 0 0 1 0 9"/></svg>', label: listening ? 'Stop listening' : 'Listen to this page', disabled: !has || !voice.available },
      { act: 'ask', icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M10 3v3M10 14v3M3 10h3M14 10h3M5.3 5.3l2.1 2.1M12.6 12.6l2.1 2.1M5.3 14.7l2.1-2.1M12.6 7.4l2.1-2.1"/></svg>', label: 'Ask Claude about this page', disabled: !has },
      { act: 'later', icon: I.bookmark, label: 'Save for later', disabled: !has },
      { act: 'zoom', icon: I.zoomIn, label: 'Zoom', disabled: !has },
      { act: 'desktop', icon: I.desktop, label: 'Desktop site', on: !!t.desk, disabled: !has },
    ],
    [
      { act: 'share', icon: I.share, label: 'Share link', disabled: !has },
      { act: 'copy', icon: I.copy, label: 'Copy link', disabled: !has },
    ],
    [
      { act: 'overview', icon: I.grid, label: 'All tabs', meta: String(S.tabs.length) },
      { act: 'private', icon: I.mask, label: 'New private tab' },
    ],
    [
      { act: 'bookmarks', icon: I.bookmark, label: 'Bookmarks', meta: S.bookmarks.length ? String(S.bookmarks.length) : '' },
      { act: 'readingList', icon: I.bookmark, label: 'Reading list', meta: laterList().length ? String(laterList().length) : '' },
      { act: 'history', icon: I.history, label: 'History' },
      { act: 'downloads', icon: I.download, label: 'Downloads', meta: S.downloads.length ? String(S.downloads.length) : '' },
    ],
  ];
  const row = (i: MenuItem): string => i.act === 'zoom' ? zoomRow(!!i.disabled, l.zoom)
    : `<button class="br-row2" role="menuitem" data-act="${i.act}"${i.disabled ? ' disabled' : ''}${i.on !== undefined ? ` aria-pressed="${i.on}"` : ''}>`
      + `${i.icon}<span class="br-r">${esc(i.label)}</span>`
      + (i.on !== undefined ? `<span class="br-mswitch${i.on ? ' on' : ''}" aria-hidden="true"><i></i></span>`
        : i.meta ? `<span class="br-m">${esc(i.meta)}</span>` : '')
      + '</button>';
  // the header: the page's site (or "Menu" on the new-tab page), and a quiet line under it
  const title = has ? host(t.url) : 'Menu';
  const sub = t.priv ? 'Private tab' : has ? (t.title && t.title !== t.url ? t.title : '') : 'New tab';
  el('brMenuList').innerHTML = `<div class="br-mhd"><div class="br-mhd-t">${esc(title)}</div>`
    + (sub ? `<div class="br-mhd-s">${esc(sub)}</div>` : '') + '</div>'
    + groups.map(g => g.map(row).join('')).join('<div class="br-msep" role="separator"></div>');
  el('brMenuList').scrollTop = 0;
  openOver('brMenu');
}

/** The zoom row: "Zoom" with − 100% +. The percentage is actual size when tapped. */
function zoomRow(off: boolean, pct: number): string {
  const dis = off ? ' disabled' : '';
  return `<div class="br-row2 br-zoom" role="group" aria-label="Zoom">${I.zoomIn}<span class="br-r">Zoom</span>`
    + `<span class="br-zoom-ctl"><button class="br-zbtn" data-zact="-1" aria-label="Zoom out"${dis}>−</button>`
    + `<button class="br-zpct" data-zact="0" aria-label="Actual size"${dis}>${pct}%</button>`
    + `<button class="br-zbtn" data-zact="1" aria-label="Zoom in"${dis}>+</button></span></div>`;
}

/** The native page reports its zoom: the menu's percentage follows, if the menu is open. */
export function zoomChanged(pct: number): void {
  const b = el('brMenuList').querySelector<HTMLElement>('.br-zpct');
  if (b && el('brMenu').classList.contains('on')) b.textContent = `${pct}%`;
}

function menuAct(act: string): void {
  closeOver('brMenu');
  const t = D.sel();
  switch (act) {
    case 'private': D.newTab('', true); break;
    case 'bookmark': toggleBookmark(); break;
    case 'find': openFind(); break;
    case 'reader': if (t.url) browser.reader(t.id); break;
    case 'listen':
      if (listening) { voice.stopSpeaking(); listening = false; }
      else if (t.url) { listenNext = true; browser.reader(t.id); }   // the article comes back as a 'reader' event
      break;
    case 'ask': if (t.url) askAboutPage(); break;
    case 'translate': if (t.url) askAboutPage('Translate this page into English, keeping its structure and its links. If it is already in English, say so and summarise it in English.'); break;
    case 'share': if (t.url) browser.share(t.title, t.url); break;
    case 'copy': if (t.url) browser.copy(t.url); break;
    case 'desktop':
      t.desk = !t.desk; saveTabs();
      browser.desktop(t.id, !!t.desk);
      D.flash(t.desk ? 'Showing the desktop site' : 'Showing the phone site');
      D.render();
      break;
    case 'overview': openOverview(); break;
    case 'bookmarks': openBookmarks(); break;
    case 'readingList': openReadingList(); break;
    case 'later': if (t.url) { laterPending = { url: t.url, title: t.title || host(t.url) }; browser.reader(t.id); } break;
    case 'history': openHistory(); break;
    case 'downloads': openDownloads(); break;
  }
}

// ---------- the undo banner: a short line over the content, for a few seconds ----------
let undoFn: (() => void) | null = null;
let undoTimer = 0;

/** Shows "text  Undo" for 5 seconds; Undo runs `undo`. A new one replaces the old one. */
export function showUndo(text: string, undo: () => void): void {
  clearTimeout(undoTimer);
  undoFn = undo;
  el('brUndoText').textContent = text;
  el('brUndo').hidden = false;
  undoTimer = window.setTimeout(hideUndo, 5000);
}

export function hideUndo(): void {
  clearTimeout(undoTimer);
  undoFn = null;
  el('brUndo').hidden = true;
}

function undoNow(): void {
  const f = undoFn;
  hideUndo();
  f?.();
}

/** The star: bookmark the current page, or take the bookmark away. */
export function toggleBookmark(): void {
  const t = cur();
  if (!t.url) return;
  if (isBookmarked(t.url)) {
    const i = S.bookmarks.findIndex(b => b.url === t.url), gone = S.bookmarks[i];
    S.bookmarks.splice(i, 1);
    showUndo('Bookmark removed', () => restoreBookmark(gone, i));
  } else {
    S.bookmarks.unshift({ url: t.url, title: t.title || host(t.url), at: Date.now() });
    S.bookmarks = S.bookmarks.slice(0, MAX_BOOK);
    D.flash('Bookmarked');
  }
  saveBookmarks();
  D.render();
  if (el('brBookmarks').classList.contains('on')) renderBookmarks();
}

/** Puts a removed bookmark back where it was (the Undo banner). */
function restoreBookmark(b: Bookmark, at: number): void {
  S.bookmarks.splice(Math.min(at, S.bookmarks.length), 0, b);
  saveBookmarks();
  D.render();
  if (el('brBookmarks').classList.contains('on')) renderBookmarks();
}

// ---------- find in page ----------
let findTab = '';                     // the tab whose find bar is open ('' for none)

export function findOpen(): boolean { return !!findTab && findTab === S.active; }

function openFind(): void {
  const t = D.sel();
  if (!t.url) return;
  findTab = t.id;
  renderFind();
  D.render();
  const l = liveOf(t.id);
  Keyboard.open({
    value: l.find.q, placeholder: 'Find in page', max: 120,
    onChange: q => { l.find.q = q; browser.find(t.id, q); },
    onDone: () => true,
  });
}

export function renderFind(): void {
  const on = findOpen();
  el('brFind').hidden = !on;
  if (!on) return;
  const l = liveOf(findTab);
  el('brFindText').textContent = l.find.q || 'Find in page';
  el('brFindText').style.color = l.find.q ? '' : 'var(--t4)';
  el('brFindCount').textContent = !l.find.q ? '' : l.find.count === 0 ? 'No matches' : `${l.find.index} of ${l.find.count}`;
}

/** The native page reports matches. */
function findResult(tab: string, count: number, index: number): void {
  const l = liveOf(tab);
  l.find.count = count;
  l.find.index = index;
  if (findOpen() && tab === findTab) renderFind();
}

function closeFind(): void {
  if (!findTab) return;
  const id = findTab;
  findTab = '';
  browser.findClose(id);
  D.render();
}

/** The app is closed in the switcher: its find bar goes with its pages. */
export function findReset(): void { findTab = ''; }

// ---------- the tab overview ----------
function openOverview(): void {
  const cur0 = D.sel();
  if (cur0.url) browser.snapshot(cur0.id);   // a picture of the page, taken before the page is put away
  renderOverview();
  openOver('brOverview');
}

function renderOverview(): void {
  const cards = S.tabs.map(t => {
    const l = liveOf(t.id);
    const thumb = l.thumb ? `<img src="${esc(l.thumb)}" alt="">` : `<span class="br-fav${t.url ? '' : ' globe'}">${t.url ? esc(host(t.url)[0]?.toUpperCase() || '?') : I.globeSm}</span>`;
    return `<div class="br-card${t.id === S.active ? ' on' : ''}${t.priv ? ' priv' : ''}" role="button" data-card="${t.id}">`
      + `<div class="br-thumb">${thumb}</div><div class="br-ct">${t.priv ? '<span class="br-priv">Private</span> · ' : ''}${esc(t.url ? (t.title || host(t.url)) : 'New tab')}</div>`
      + `<button class="br-cx" data-cclose="${t.id}" aria-label="Close tab">${I.xSm}</button></div>`;
  });
  // at the tab limit the new-tab choices say so instead of doing nothing
  const full = S.tabs.length >= MAX_TABS;
  cards.push(`<button class="br-card add" data-cnew="1"${full ? ' disabled' : ''}>${I.plus}<span>${full ? 'Close a tab first' : 'New tab'}</span></button>`);
  el('brCards').innerHTML = cards.join('');
  el<HTMLButtonElement>('brOverviewNew').disabled = full;
}

// ---------- full pages ----------
let historyQ = '';
let clearArmed = false;

function openHistory(): void { historyQ = ''; clearArmed = false; renderHistory(); openOver('brHistory'); }

function renderHistory(): void {
  el('brHistoryQ').textContent = historyQ || 'Search your history';
  const q = historyQ.trim().toLowerCase();
  const rows = S.history.filter(v => !q || v.url.toLowerCase().includes(q) || v.title.toLowerCase().includes(q));
  let html = '';
  if (clearArmed) {
    html += `<div class="br-item"><span class="br-it-t"><b>Clear all of your history?</b><small>This can’t be undone.</small></span>`
      + `<span class="br-acts"><button class="br-mini danger" data-hclear="1">Clear all</button><button class="br-mini" data-hkeep="1">Keep</button></span></div>`;
  }
  let day = '';
  for (const v of rows) {
    const d = dayOf(v.at);
    if (d !== day) { day = d; html += `<div class="br-day">${esc(d)}</div>`; }
    html += `<button class="br-item" data-hurl="${esc(v.url)}"><span class="br-ic">${I.globeSm}</span><span class="br-it-t"><b>${esc(v.title || host(v.url))}</b>`
      + `<small>${esc(host(v.url))} · ${esc(ago(v.at))}</small></span></button>`;
  }
  el('brHistoryList').innerHTML = html || `<div class="br-empty-l">${q ? 'Nothing matches that.' : 'Pages you open will show up here.'}</div>`;
}

function openBookmarks(): void { renderBookmarks(); openOver('brBookmarks'); }

// ---------- reading list: pages saved to read later, kept with their text (no network needed to read them again) ----------
interface Later { url: string; title: string; json: string; at: number }
const LATER_KEY = 'browser.later', LATER_MAX = 30;
let laterPending: { url: string; title: string } | null = null;   // a page being saved: its reader text comes next
function laterList(): Later[] {
  try { const l = JSON.parse(store.get(LATER_KEY) || '[]') as Later[]; return Array.isArray(l) ? l : []; } catch { return []; }
}
function saveLater(list: Later[]): void { store.set(LATER_KEY, JSON.stringify(list.slice(0, LATER_MAX))); }
/** The reader text for a page being saved (from the 'reader' event): keep it and say so. */
function keepForLater(json: string): void {
  const p = laterPending!;
  laterPending = null;
  if (!json) { D.flash('Nothing to save on this page'); return; }
  const list = laterList().filter(x => x.url !== p.url);
  list.unshift({ url: p.url, title: p.title, json, at: Date.now() });
  saveLater(list);
  D.flash('Saved for later');
}
function openReadingList(): void { renderReadingList(); openOver('brLater'); }
function renderReadingList(): void {
  const list = laterList();
  el('brLaterList').innerHTML = list.map((x, i) =>
    `<div class="br-item" role="button" data-later-open="${i}"><span class="br-ic">${I.bookmark}</span><span class="br-it-t"><b>${esc(x.title || host(x.url))}</b>`
    + `<small>${esc(host(x.url))} · ${esc(ago(x.at))}</small></span><span class="br-acts"><button class="br-mini" data-later-del="${i}">Remove</button></span></div>`).join('')
    || '<div class="br-empty-l">Use “Save for later” in the menu to keep a page to read here.</div>';
}

function renderBookmarks(): void {
  el('brBookmarkList').innerHTML = S.bookmarks.map((b, i) =>
    `<div class="br-item" role="button" data-burl="${esc(b.url)}"><span class="br-ic">${I.star}</span><span class="br-it-t"><b>${esc(b.title || host(b.url))}</b>`
    + `<small>${esc(host(b.url))}</small></span><span class="br-acts"><button class="br-mini" data-bdel="${i}">Remove</button></span></div>`).join('')
    || '<div class="br-empty-l">Tap the star in the address bar to keep a page here.</div>';
}

function openDownloads(): void { reconcileDownloads(); renderDownloads(); openOver('brDownloads'); }

/** Asks the tablet about the downloads still in progress (what happened while the app was away). */
export function reconcileDownloads(): void {
  const ids = S.downloads.filter(d => d.id > 0 && d.state !== 'done' && d.state !== 'gone').map(d => d.id);
  if (!ids.length) return;
  for (const info of browser.downloadsInfo(ids)) {
    const d = S.downloads.find(x => x.id === info.id);
    if (!d) continue;
    d.state = info.state;
    if (info.uri) d.uri = info.uri;
    if (info.mime) d.mime = info.mime;
    if (info.bytes != null) d.bytes = info.bytes;
    if (info.total != null) d.total = info.total;
  }
  saveDownloads();
}

function renderDownloads(): void {
  const list = S.downloads.map((d, i) => {
    let meta = '', actions = '';
    if (d.state === 'running') {
      const pct = d.total > 0 ? Math.min(100, Math.round(d.bytes * 100 / d.total)) : 0;
      meta = `<div class="br-progressbar"><i style="width:${Math.max(4, pct)}%"></i></div><small>${esc(size(d.bytes))}${d.total > 0 ? ` of ${esc(size(d.total))}` : ''}</small>`;
    } else if (d.state === 'done') {
      meta = `<small>${esc(size(d.total || d.bytes) || 'Saved')} · ${esc(ago(d.at))}</small>`;
      actions = `<button class="br-mini" data-dopen="${i}">Open</button>`;
    } else if (d.state === 'failed') {
      meta = `<small>${esc(d.message || 'Didn’t finish')}</small>`;
    } else {
      meta = '<small>Removed from the tablet</small>';
    }
    actions += `<button class="br-mini" data-ddel="${i}">Delete</button>`;   // the red one is on the sheet that asks first
    return `<div class="br-item"><span class="br-ic">${I.download}</span><span class="br-it-t"><b>${esc(d.name || 'Download')}</b>${meta}</span><span class="br-acts">${actions}</span></div>`;
  });
  el('brDownloadList').innerHTML = list.join('') || '<div class="br-empty-l">Files you download show up here.</div>';
}

// ---------- deleting a download: the ClaudeOS sheet asks first (the file leaves the tablet) ----------
let delDl: Dl | null = null;

function askDeleteDownload(d: Dl): void {
  delDl = d;
  openOver('brDel');
}

function deleteDownload(): void {
  const d = delDl;
  delDl = null;
  hideOver('brDel');
  D.sync();
  const i = d ? S.downloads.indexOf(d) : -1;
  if (!d || i < 0) return;
  browser.removeDownload(d.id, d.uri);
  S.downloads.splice(i, 1);
  saveDownloads(); renderDownloads(); D.render();
}

/** Re-draws the Downloads page when it is open (download progress). */
export function downloadsChanged(): void { if (el('brDownloads').classList.contains('on')) renderDownloads(); }

// "Listen to this page": the article's text, read aloud by the tablet's voice (the menu's Stop listening ends it)
let listenNext = false;   // the next reader text is for listening, not for the reader page
let listening = false;
function speakArticle(json: string): void {
  let a: { title?: string; blocks?: { text: string }[] } | null = null;
  try { a = json ? JSON.parse(json) : null; } catch { a = null; }
  const body = (a?.blocks || []).map(b => b.text).join(' ').replace(/\s+/g, ' ').trim();
  if (!body) { D.flash('No article to read on this page'); return; }
  const text = `${a?.title ? a.title + '. ' : ''}${body}`.slice(0, 4000);
  listening = true;
  voice.speak(text, 'page');
  D.flash('Listening');
}

// the tablet reports the end of the speech with a 'spoken' event carrying the same id: the menu goes back to "Listen"
voice.on(e => { if (e.type === 'spoken' && e.id === 'page') listening = false; });

function showArticle(json: string): void {
  let a: { title?: string; byline?: string; host?: string; blocks?: { tag: string; text: string }[] } | null = null;
  try { a = json ? JSON.parse(json) : null; } catch { a = null; }
  if (!a || !a.blocks || !a.blocks.length) { D.flash('No article to read on this page'); return; }
  const head = `<h1>${esc(a.title || '')}</h1><p class="br-by">${esc([a.byline, a.host].filter(Boolean).join(' · '))}</p>`;
  el('brArticle').innerHTML = head + a.blocks.map(b => {
    const t = esc(b.text);
    switch (b.tag) {
      case 'h1': case 'h2': return `<h2>${t}</h2>`;
      case 'h3': case 'h4': return `<h3>${t}</h3>`;
      case 'li': return `<p>• ${t}</p>`;
      case 'blockquote': return `<blockquote>${t}</blockquote>`;
      case 'pre': return `<pre>${t}</pre>`;
      default: return `<p>${t}</p>`;
    }
  }).join('');
  openOver('brReader');
}

// ---------- the long-press sheet ----------
let ctxState: { tab: string; kind: string; url: string; image: string } | null = null;

function openContext(e: BrowserEvent): void {
  const kind = e.kind || 'link';
  const url = e.url || '', image = e.image || '';
  ctxState = { tab: e.tab, kind, url, image };
  const acts: [string, string][] = kind === 'image' ? [['save', 'Save image']]
    : kind === 'imagelink' ? [['newtab', 'Open link in new tab'], ['copy', 'Copy link'], ['share', 'Share link'], ['save', 'Save image']]
    : [['newtab', 'Open in new tab'], ['copy', 'Copy link'], ['share', 'Share link'], ['download', 'Download link']];
  el('brCtxTitle').textContent = url ? host(url) : host(image) || 'Picture';
  const icon: Record<string, string> = { newtab: I.plus, copy: I.copy, share: I.share, download: I.download, save: I.photo };
  el('brCtxList').innerHTML = acts.map(([a, label]) => `<button class="br-row2" data-cact="${a}">${icon[a] || I.link}<span class="br-r">${esc(label)}</span></button>`).join('');
  openOver('brCtx');
}

// ---------- uploads: the page's file chooser ----------
let chooser: { tab: string; accept: string; multiple: boolean; capture: boolean } | null = null;

function openChooser(e: BrowserEvent): void {
  if (chooser) browser.chooseFile(chooser.tab, 'cancel');   // a second one replaces the first
  chooser = { tab: e.tab, accept: e.accept || '', multiple: !!e.multiple, capture: !!e.capture };
  // ClaudeOS's own photos only: no Android picker. The camera is ClaudeOS's Camera app (its photos land in the list)
  el('brChooseList').innerHTML = [
    ['photos', I.photo, 'ClaudeOS photos'],
    ['camera', I.camera, 'Take a photo in Camera'],
  ].map(([k, ic, label]) => `<button class="br-row2" data-kact="${k}">${ic}<span class="br-r">${esc(label)}</span></button>`).join('');
  openOver('brChoose');
}

async function openPhotos(): Promise<void> {
  hideOver('brChoose');
  el('brPhotoGrid').innerHTML = '<div class="br-msg-line">Loading…</div>';
  openOver('brPhotos');
  try {
    const list = await getJson<PhotoList>('/api/photos/list?limit=80');
    const items = list.days.flatMap(d => d.photos);
    el('brPhotoGrid').innerHTML = items.length
      ? items.map(p => `<button data-photo="${esc(p.id)}" aria-label="Choose this photo"><img src="${esc(thumbUrl(p.id))}" alt="" loading="lazy"></button>`).join('')
      : '<div class="br-msg-line">No photos yet. Take one with the camera in ClaudeOS first.</div>';
  } catch {
    el('brPhotoGrid').innerHTML = '<div class="br-msg-line">The photos didn’t load. ClaudeOS can’t reach the PC.</div>';
  }
}

async function choosePhoto(id: string): Promise<void> {
  const c = chooser;
  if (!c) return;
  const url = `/api/photos/file?id=${encodeURIComponent(id)}`;
  try {
    const blob = await fetch(url).then(r => r.blob());
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
    chooser = null;
    browser.chooseFile(c.tab, 'photo', dataUrl, `${id}.jpg`);
    hideOver('brPhotos');
    D.sync();
  } catch {
    D.flash('That photo didn’t load');
  }
}

// ---------- site permissions ----------
/** A site's ask, waiting for an answer. tab: the tab that was on screen when it came (the tablet doesn't name one). */
interface Ask { reqId: string; host: string; kinds: PermKind[]; tab: string }
const asks: Ask[] = [];

/** Turns the tablet's ask into a host and kinds we can show; null when either is missing or unknown. */
function askOf(e: BrowserEvent): { host: string; kinds: PermKind[] } | null {
  const h = (e.host || (e.origin ? host(e.origin) : '')).trim().toLowerCase();
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(h)) return null;               // an empty or odd origin: nothing to show
  const kinds = (e.kinds || '').split(',').map(k => k.trim()).filter((k): k is PermKind => (PERM_KINDS as string[]).includes(k));
  return kinds.length ? { host: h, kinds } : null;
}

function askPermission(e: BrowserEvent): void {
  const deny = (why: string) => { console.warn(`browser: permission ask dropped (${why})`, e); if (e.reqId) browser.permission(e.reqId, false); };
  if (!e.reqId) { console.warn('browser: permission ask without a reqId', e); return; }
  const a = askOf(e);
  if (!a) { deny('no usable site or permission'); return; }
  // a page can only ask while it is on screen: no page, or the Browser isn't showing, means nobody can answer
  if (!D.shown() || !cur().url) { deny('no page on screen'); return; }
  const stored = S.perms[a.host] || {};
  if (a.kinds.every(k => stored[k])) {                       // answered before: no sheet
    browser.permission(e.reqId, a.kinds.every(k => stored[k] === 'allow'));
    return;
  }
  asks.push({ reqId: e.reqId, host: a.host, kinds: a.kinds, tab: cur().id });
  if (asks.length === 1) showAsk();
  D.ctx.requestAttention();
}

/** Answers "no" to the asks of a tab that closed or went to another page (the page that asked is gone). */
export function dropAsks(tab: string): void {
  let changed = false;
  for (let i = asks.length - 1; i >= 0; i--) {
    if (asks[i].tab !== tab) continue;
    browser.permission(asks[i].reqId, false);
    asks.splice(i, 1); changed = true;
  }
  if (!changed) return;
  if (asks.length) showAsk(); else { hideOver('brPerm'); D.sync(); }
}

/** The hub's Back, topmost first: a sheet or dialog (a permission asks "Not now", a dialog cancels), then a full page
 *  (as its Back button does), then the find bar. True when one of them closed. */
export function backClosesPanel(): boolean {
  const open = [...D.ctx.root.querySelectorAll<HTMLElement>('.br-sheet-wrap.on, .br-full.on')];   // sheets come last in the DOM
  const top = open[open.length - 1];
  if (top?.id) { closeOver(top.id); return true; }
  if (findOpen()) { closeFind(); return true; }
  return false;
}

function showAsk(): void {
  const a = asks[0];
  if (!a) return;
  const what = a.kinds.map(k => k === 'geolocation' ? 'your location' : k === 'camera' ? 'the camera' : 'the microphone');
  const whatTxt = what.length > 1 ? `${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}` : what[0];
  el('brPermTitle').textContent = `${a.host} wants to use ${whatTxt}`;
  el('brPermBody').textContent = 'ClaudeOS asks first, and remembers your answer for this site. You can forget it in the Browser’s settings.';
  openOver('brPerm');
}

function answerAsk(allow: boolean, remember: 'allow' | 'deny' | null): void {
  const a = asks.shift();
  if (!a) return;
  if (remember) {
    const cur2 = S.perms[a.host] || {};
    for (const k of a.kinds) cur2[k] = remember;
    S.perms[a.host] = cur2;
    savePerms();
  }
  browser.permission(a.reqId, allow);
  hideOver('brPerm');
  if (asks.length) showAsk(); else D.sync();
}

// ---------- share: ClaudeOS's own sheet for a link ----------
let shareOf: { title: string; url: string } | null = null;

function openShare(e: BrowserEvent): void {
  const url = e.url || '';
  if (!url) return;
  shareOf = { title: e.title || '', url };
  el('brShareTitle').textContent = host(url) || url;
  el('brShareUrl').textContent = url;
  el('brShareList').innerHTML = `<button class="br-row2" data-sact="copy">${I.copy}<span class="br-r">Copy link</span></button>`
    + `<button class="br-row2" data-sact="claude">${I.share}<span class="br-r">Send to a Claude session</span></button>`;
  openOver('brShare');
}

// ---------- files: a downloaded file, shown in ClaudeOS ----------
/** The name of the file the Downloads page is opening (the tablet doesn't send it back with the file). */
let viewerTitle = '';

function openViewer(e: BrowserEvent): void {
  const body = el('brViewerBody');
  el('brViewerTitle').textContent = viewerTitle || 'File';
  if (e.kind === 'image' && e.data) {
    body.innerHTML = `<img src="${esc(e.data)}" alt="">`;
  } else if (e.kind === 'text') {
    const pre = document.createElement('pre');
    pre.textContent = e.text || '';
    body.replaceChildren(pre);
  } else {
    body.innerHTML = `<div class="br-msg-line">${esc(e.message || 'ClaudeOS can’t show this kind of file yet.')}</div>`;
  }
  openOver('brViewer');
}

// ---------- a page's alert, confirm or prompt: a ClaudeOS sheet ----------
interface Dlg { id: string; kind: 'alert' | 'confirm' | 'prompt'; message: string; value: string; host: string }
const dialogs: Dlg[] = [];
let dlgValue = '';

function askDialog(e: BrowserEvent): void {
  if (!e.dialogId) return;
  const kind = e.kind === 'confirm' || e.kind === 'prompt' ? e.kind : 'alert';
  // only a page on screen can answer: otherwise the page is simply told no
  if (!D.shown() || !cur().url) { browser.dialog(e.dialogId, false, ''); return; }
  dialogs.push({ id: e.dialogId, kind, message: e.message || '', value: e.value || '', host: e.host || '' });
  if (dialogs.length === 1) showDialog();
  D.ctx.requestAttention();
}

function showDialog(): void {
  const d = dialogs[0];
  if (!d) return;
  el('brDlgTitle').textContent = d.host ? `${d.host} says` : 'This page says';
  el('brDlgBody').textContent = d.message;
  el('brDlgField').hidden = d.kind !== 'prompt';
  dlgValue = d.value;
  paintDlgValue();
  el('brDlgCancel').hidden = d.kind === 'alert';
  openOver('brDialog');
}

function paintDlgValue(): void {
  el('brDlgText').textContent = dlgValue || 'Type here';
  el('brDlgText').style.color = dlgValue ? '' : 'var(--t4)';
}

function answerDialog(ok: boolean): void {
  const d = dialogs.shift();
  if (!d) return;
  browser.dialog(d.id, ok, d.kind === 'prompt' ? dlgValue : '');
  hideOver('brDialog');
  if (dialogs.length) showDialog(); else D.sync();
}

// ---------- events from the tablet ----------
/** The events the panels handle; returns false for the others. */
export function panelEvent(e: BrowserEvent): boolean {
  switch (e.type) {
    case 'chooser': openChooser(e); return true;
    case 'context': openContext(e); return true;
    case 'reader':
      if (laterPending) keepForLater(e.article || '');
      else if (listenNext) { listenNext = false; speakArticle(e.article || ''); }
      else showArticle(e.article || '');
      return true;
    case 'permission': askPermission(e); return true;
    case 'find': findResult(e.tab, e.count ?? 0, e.index ?? 0); return true;
    case 'share': openShare(e); return true;
    case 'viewer': openViewer(e); return true;
    case 'dialog': askDialog(e); return true;
    default: return false;
  }
}

// ---------- setup: the buttons on these panels ----------
export function initPanels(deps: PanelDeps): void {
  D = deps;
  // a sheet goes away when its background is tapped; a full page when its Back button is
  document.querySelectorAll<HTMLElement>('#app-browser [data-close-over]').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) closeOver(o.id); });
  });
  document.querySelectorAll<HTMLElement>('#app-browser .br-back').forEach(b => {
    b.addEventListener('click', () => { const o = b.closest<HTMLElement>('.br-over'); if (o && o.id) closeOver(o.id); });
  });
  el('brMenuList').addEventListener('click', e => {
    const z = (e.target as Element).closest<HTMLButtonElement>('[data-zact]');
    if (z) { if (!z.disabled) browser.zoom(D.sel().id, +z.dataset.zact!); return; }   // the menu stays open for more steps
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-act]');
    if (b && !b.disabled) menuAct(b.dataset.act!);
  });
  el('brCtxList').addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-cact]');
    if (!b || !ctxState) return;
    const c = ctxState;
    closeOver('brCtx');
    browser.contextAction(c.tab, b.dataset.cact!, c.url, c.image);
  });
  el('brChooseList').addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-kact]');
    if (!b || !chooser) return;
    const k = b.dataset.kact!;
    if (k === 'photos') { openPhotos(); return; }
    const c = chooser;
    chooser = null;
    browser.chooseFile(c.tab, 'cancel');   // the page's upload is called off; the photo can be picked again after
    hideOver('brChoose');
    D.sync();
    if (k === 'camera') openApp('camera');
  });
  // Cancel on the upload and photo sheets: the page's upload is called off, the same as tapping outside
  el('brChooseCancel').addEventListener('click', () => closeOver('brChoose'));
  el('brPhotosCancel').addEventListener('click', () => closeOver('brPhotos'));
  el('brPhotoGrid').addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-photo]');
    if (b) choosePhoto(b.dataset.photo!);
  });
  el('brShareList').addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-sact]');
    if (!b || !shareOf) return;
    const s = shareOf;
    shareOf = null;
    closeOver('brShare');
    if (b.dataset.sact === 'copy') browser.copy(s.url);
    else askWithText(s.title ? `${s.title}\n${s.url}` : s.url);   // the Claude composer starts with the link
  });
  el('brDlgField').addEventListener('click', () => {
    Keyboard.open({ value: dlgValue, placeholder: 'Type here', max: 200,
      onChange: v => { dlgValue = v; paintDlgValue(); }, onDone: () => true });
  });
  el('brDlgOk').addEventListener('click', () => answerDialog(true));
  el('brDlgCancel').addEventListener('click', () => answerDialog(false));
  el('brPermAllow').addEventListener('click', () => answerAsk(true, 'allow'));
  el('brPermNot').addEventListener('click', () => answerAsk(false, null));
  el('brPermBlock').addEventListener('click', () => answerAsk(false, 'deny'));

  // full pages
  el('brHistorySearch').addEventListener('click', () => {
    Keyboard.open({ value: historyQ, placeholder: 'Search your history', max: 80,
      onChange: q => { historyQ = q; renderHistory(); }, onDone: () => true });
  });
  el('brHistoryClear').addEventListener('click', () => { clearArmed = !clearArmed; renderHistory(); });
  el('brHistoryList').addEventListener('click', e => {
    const t = e.target as Element;
    if (t.closest('[data-hclear]')) { S.history = []; saveHistory(); clearArmed = false; renderHistory(); D.render(); return; }
    if (t.closest('[data-hkeep]')) { clearArmed = false; renderHistory(); return; }
    const b = t.closest<HTMLElement>('[data-hurl]');
    if (b) { closeOver('brHistory'); D.open(b.dataset.hurl!); }
  });
  el('brBookmarkList').addEventListener('click', e => {
    const t = e.target as Element;
    const del = t.closest<HTMLElement>('[data-bdel]');
    if (del) {
      const i = +del.dataset.bdel!, gone = S.bookmarks[i];
      if (!gone) return;
      S.bookmarks.splice(i, 1); saveBookmarks(); renderBookmarks(); D.render();
      showUndo(`Removed ${gone.title || host(gone.url)}`, () => restoreBookmark(gone, i));
      return;
    }
    const b = t.closest<HTMLElement>('[data-burl]');
    if (b) { closeOver('brBookmarks'); D.open(b.dataset.burl!); }
  });
  el('brDelGo').addEventListener('click', deleteDownload);
  el('brLaterList').addEventListener('click', e => {
    const t = e.target as Element;
    const d = t.closest<HTMLElement>('[data-later-del]');
    if (d) { const list = laterList(); list.splice(+d.dataset.laterDel!, 1); saveLater(list); renderReadingList(); return; }
    const o = t.closest<HTMLElement>('[data-later-open]');
    if (o) {
      const x = laterList()[+o.dataset.laterOpen!];
      if (!x) return;
      closeOver('brLater');
      showArticle(x.json);
      openOver('brReader');
    }
  });
  el('brDelKeep').addEventListener('click', () => closeOver('brDel'));
  el('brUndoBtn').addEventListener('click', undoNow);
  el('brDownloadList').addEventListener('click', e => {
    const t = e.target as Element;
    const del = t.closest<HTMLElement>('[data-ddel]');
    const open = t.closest<HTMLElement>('[data-dopen]');
    if (del) {
      const d = S.downloads[+del.dataset.ddel!];
      if (d) askDeleteDownload(d);
    } else if (open) {
      const d = S.downloads[+open.dataset.dopen!];
      if (d && d.uri) { viewerTitle = d.name; browser.openFile(d.uri, d.mime); }
    }
  });
  el('brFindField').addEventListener('click', () => openFind());
  el('brFindPrev').addEventListener('click', () => { const t = D.sel(); browser.findStep(t.id, false); });
  el('brFindNext').addEventListener('click', () => { const t = D.sel(); browser.findStep(t.id, true); });
  el('brFindClose').addEventListener('click', () => closeFind());
  el('brCards').addEventListener('click', e => {
    const t = e.target as Element;
    const x = t.closest<HTMLElement>('[data-cclose]');
    if (x) { D.closeTab(x.dataset.cclose!); renderOverview(); return; }
    if (t.closest('[data-cnew]')) { closeOver('brOverview'); D.newTab(); return; }
    const c = t.closest<HTMLElement>('[data-card]');
    if (c) { closeOver('brOverview'); D.select(c.dataset.card!); }
  });
  el('brOverviewNew').addEventListener('click', () => { closeOver('brOverview'); D.newTab(); });
}

/** For the tab-overview's live pictures: re-draws the cards when open. */
export function overviewChanged(): void { if (el('brOverview').classList.contains('on')) renderOverview(); }

/** Opens Bookmarks / History / Downloads / Menu from outside (the new-tab page and the bar). */
export const panels = {
  menu: openMenu,
  history: openHistory,
  bookmarks: openBookmarks,
  downloads: openDownloads,
  overview: openOverview,
  find: openFind,
};

