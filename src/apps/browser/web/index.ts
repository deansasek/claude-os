// The Browser app: tabs, the address bar, the new-tab page, and what the tablet tells the page about each tab.
// On the tablet each tab is a native WebView that Android places exactly over #brFrame (BrowserView.java, through
// `browser` in device.ts); with ?device=mock an iframe stands in. The menu, find bar, history, bookmarks, downloads,
// reader view, tab overview and sheets are in panels.ts; the data and helpers are in state.ts.
//
// The native page sits above everything Claude Home draws, so it is hidden whenever something should be on top:
//   - this app isn't on screen (onHide), or the tab shows our own page (new tab, an error, suggestions, a panel);
//   - the keyboard, control center, ambient screen, app switcher or a banner is up, or anything else dispatches
//     dispatchEvent(new CustomEvent('hub:cover', { detail: true }))  (and false when it's gone).
import { esc, report, setStageInset, store } from '../../../core/web/dom.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { browser, onResume, type BrowserEvent } from '../../../core/web/device.ts';
import { initClaudePanel } from './claude-panel.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import { appSettingsChanged, registerAppSettings, type SettingRow } from '../../../core/web/app-settings.ts';
import { manifest } from '../manifest.ts';
import { hasNumberId, hasStringId, hasUrl, isVisit, readSavedList, readSavedObject } from './saved-list.ts';
import { suggestMatches } from './state.ts';
import {
  I, S, ENGINES, DEFAULT_QUICK, K, MAX_TABS, MAX_QUICK, MAX_DL, MAX_PAST, PERM_KINDS, PERM_LABEL, type Tab, type Engine, type Quick,
  type Visit, type Bookmark, type Dl, type Perms, type Live, host, liveOf, cur, newId, readJson, resolveInput, reading, ago, visit,
  isBookmarked, saveTabs, saveHistory, saveQuick, saveDownloads, savePerms, dlByKey, provideControl,
} from './state.ts';
import {
  initPanels, panels, panelEvent, toggleBookmark, renderFind, findOpen, findReset, downloadsChanged, reconcileDownloads,
  overviewChanged, dropAsks, backClosesPanel, showUndo, hideUndo, zoomChanged,
} from './panels.ts';
import { onBack, openApp } from '../../../core/web/system.ts';

export { resolveInput } from './state.ts';

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);

let shown = false;            // the app is on screen
let editing = false;          // the address keyboard is up (suggestions show)
let editQuick = false;
let coverExternal = 0;        // hub:cover requests
let lastCover: boolean | null = null;
let nativeOn = false;         // we last asked for the native page to show
let lastShow = '';            // the tab and rectangle of the last browser.show (skipped when unchanged)
let chromeOpen = false;       // Google sign-in is in Chrome's side sheet on the right: this side shows a note meanwhile

function favicon(t: { url: string; icon?: string }): string {
  if (!t.url) return `<span class="br-fav globe">${I.globeSm}</span>`;
  if (t.icon) return `<span class="br-fav"><img src="${esc(t.icon)}" alt="" onerror="this.parentNode.textContent='${esc(host(t.url)[0]?.toUpperCase() || '?')}'"></span>`;
  return `<span class="br-fav">${esc(host(t.url)[0]?.toUpperCase() || '?')}</span>`;
}

// ---------- drawing ----------
function renderTabs(): void {
  $('brTabs').innerHTML = S.tabs.map(t => `<div class="br-tab${t.id === S.active ? ' on' : ''}${t.priv ? ' priv' : ''}" role="button" data-tab="${t.id}">`
    + `${t.priv ? `<span class="br-fav globe">${I.mask}</span>` : favicon(t)}<span class="br-t">${esc(t.url ? (t.title || host(t.url)) : 'New tab')}</span>`
    + `<span class="br-x" role="button" data-close="${t.id}" aria-label="Close tab">${I.xSm}</span></div>`).join('');
  $<HTMLButtonElement>('brNew').disabled = S.tabs.length >= MAX_TABS;
  $('brCount').textContent = String(S.tabs.length);
  $('brTabs').querySelector('.br-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

let noteTimer = 0, note = '';
function renderBar(): void {
  const t = cur(), l = liveOf(t.id);
  $<HTMLButtonElement>('brBack').disabled = !canBack(t, l);
  $<HTMLButtonElement>('brFwd').disabled = !t.url || !l.fwd;
  const r = $<HTMLButtonElement>('brReload');
  r.disabled = !t.url;
  r.innerHTML = l.loading ? I.stop : I.reload;
  r.setAttribute('aria-label', l.loading ? 'Stop' : 'Reload');
  const star = $<HTMLButtonElement>('brStar');
  const on = !!t.url && isBookmarked(t.url);
  star.disabled = !t.url;
  star.classList.toggle('on', on);
  star.setAttribute('aria-label', on ? 'Remove bookmark' : 'Bookmark this page');
  const h = $('brHost');
  h.textContent = note || (t.url ? (t.priv ? `Private · ${host(t.url)}` : host(t.url)) : t.priv ? 'Private tab · search or type an address' : 'Search or type an address');
  h.classList.toggle('ph', !note && !t.url);
  // https: the lock. http: only a local page gets here (public ones are upgraded or refused): "Not secure", no lock
  $('brLock').innerHTML = note ? '' : t.url.startsWith('https:') ? I.lock : t.url.startsWith('http:') ? '<span class="br-insecure">Not secure</span>' : '';
  const bar = $('brLoad');
  bar.classList.toggle('on', l.loading && !!t.url);
  bar.style.width = `${l.loading ? Math.max(8, l.progress) : 100}%`;
}

/** A short line in the address bar for a few seconds (it's above the native page, so always visible). */
function flash(text: string): void {
  note = text; renderBar();
  clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => { note = ''; renderBar(); }, 3200);
}

/** Back can do something here: the page's own history, or a page that Home put away. */
function canBack(t: Tab, l: Live): boolean { return (!!t.url && l.back) || !!t.past?.length; }

function renderNtp(): void {
  const past = cur().past;
  $('brNtpBack').hidden = !past?.length;
  if (past?.length) $('brNtpBack').textContent = `Back to ${host(past[past.length - 1])}`;
  $('brSearchPh').textContent = `Search ${ENGINES[S.engine].label} or type an address`;
  const h = new Date().getHours();
  $('brGreet').textContent = h < 5 ? 'Up late? Where to?' : h < 12 ? 'Good morning. Where to?' : h < 18 ? 'Where to?' : 'Good evening. Where to?';
  $('brEdit').textContent = editQuick ? 'Done' : 'Edit';
  $('brEdit').hidden = !editQuick && !S.quick.length;
  $('brQuick').innerHTML = S.quick.map((q, i) => `<div class="br-q" role="button" data-q="${i}">`
    + `<span class="br-fav">${esc((q.title || host(q.url))[0]?.toUpperCase() || '?')}</span><span class="br-qn">${esc(q.title || host(q.url))}</span>`
    + (editQuick ? `<span class="br-qx" role="button" data-qx="${i}" aria-label="Remove">${I.xSm}</span>` : '') + '</div>').join('')
    + (editQuick || S.quick.length === 0 ? (S.quick.length < MAX_QUICK ? `<div class="br-q add" role="button" data-qadd="1">${I.plus}<span class="br-qn">Add</span></div>` : '') : '');
  const recent: Visit[] = [];
  for (const v of S.history) { if (!recent.some(r => host(r.url) === host(v.url))) recent.push(v); if (recent.length >= 6) break; }
  $('brRecent').innerHTML = recent.length
    ? recent.map(v => `<button class="br-row" data-url="${esc(v.url)}">${favicon({ url: v.url })}<span class="br-rt">${esc(v.title || host(v.url))}</span><span class="br-rd">${esc(host(v.url))} · ${esc(ago(v.at))}</span></button>`).join('')
    : '<div class="br-empty">Sites you visit will show up here.</div>';
}

function renderSuggest(text: string): void {
  const q = text.trim().toLowerCase();
  const rows: string[] = [];
  if (q) {
    const r = reading(text);
    rows.push(`<button class="br-row" data-url="${esc(r.url)}">${r.search ? I.searchSm : I.globeSm}<span class="br-rt">${esc(r.search ? `Search ${ENGINES[S.engine].label} for “${text.trim()}”` : r.url)}</span></button>`);
    if (r.alt) rows.push(`<button class="br-row" data-url="${esc(r.alt)}">${I.globeSm}<span class="br-rt">${esc(`Go to ${text.trim()}`)}</span></button>`);
    for (const h of suggestMatches(q, S.history, S.bookmarks, 7 - rows.length)) {
      rows.push(`<button class="br-row" data-url="${esc(h.url)}">${h.kind === 'bookmark' ? I.star : I.clockSm}<span class="br-rt">${esc(h.title || host(h.url))}</span><span class="br-rd">${esc(host(h.url))}</span></button>`);
    }
  }
  $('brSuggest').innerHTML = rows.join('') || '<div class="br-empty">Type an address, or words to search.</div>';
}

/** Which of our own pages covers the content area, and whether the native page should show. */
function renderContent(): void {
  const t = cur(), l = liveOf(t.id);
  $('brSuggest').hidden = !editing;
  $('brMsg').hidden = editing || !t.url || !l.error;
  $('brNtp').hidden = editing || !!t.url;
  if (l.error) {
    $('brMsgTitle').textContent = l.error.title;
    $('brMsgBody').textContent = l.error.body;
    // the error page's buttons: Try again only where it can help; Back when there is a page to go back to;
    // the one that fits best is the primary (ink) button
    $('brRetry').hidden = !l.error.retry;
    const back = canBack(t, l);
    $('brMsgBack').hidden = !back;
    const primary = l.error.retry ? 'brRetry' : back ? 'brMsgBack' : 'brMsgHome';
    for (const id of ['brRetry', 'brMsgBack', 'brMsgHome']) $(id).classList.toggle('quiet', id !== primary);
  }
  if (!t.url) renderNtp();
  renderFind();
  $('brFrame').classList.toggle('shift', findOpen() && !!t.url);
  sync();
}

function render(): void { renderTabs(); renderBar(); renderContent(); }

// ---------- the native page ----------
function covered(): boolean {
  if (coverExternal > 0 || Keyboard.isOpen) return true;
  return !!document.querySelector('#cc.on, #amb.on, .sw-shade.on, #banner.on, .stage.amb-on');
}

/** The header variant: 'full' (the name, the tabs row above the bar) or 'compact' (the name hidden, the page higher). */
/** Compact (bar first, no header) is the default; Full is kept in Settings for anyone who wants the header. */
function headerVariant(): 'full' | 'compact' { return store.get(K.header) === 'full' ? 'full' : 'compact'; }
function applyHeader(): void {
  ctx.root.classList.toggle('br-compact', headerVariant() === 'compact');
  syncSoon();   // the page's place moved with the bar
}

/** A panel of this app (menu, history, a sheet...) is on top of the content area. */
function panelOpen(): boolean { return !!ctx.root.querySelector('.br-over.on:not(#brMenu)'); }   // the ⋯ menu is a column beside the page, not over it

function rect(): { x: number; y: number; w: number; h: number } {
  const r = $('brFrame').getBoundingClientRect(), d = devicePixelRatio || 1;
  return { x: r.left * d, y: r.top * d, w: r.width * d, h: r.height * d };
}

/** Tell the tablet what to show. Called on every change; cheap. */
function sync(): void {
  const t = cur(), l = liveOf(t.id);
  const cov = covered();
  if (cov !== lastCover) { lastCover = cov; browser.cover(cov); }
  const want = shown && !!t.url && !l.error && !editing && !panelOpen() && !chromeOpen;
  if (want) {
    const r = rect();
    const key = `${t.id}|${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`;
    if (key !== lastShow || !nativeOn) {
      browser.configure(t.id, !!t.priv, !!t.desk);   // only matters before the tab's page exists
      browser.show(t.id, t.url, r);
      lastShow = key;
    }
    nativeOn = true;
  } else if (nativeOn) { browser.hide(); nativeOn = false; lastShow = ''; }
}
let syncRaf = 0;
const syncSoon = () => { cancelAnimationFrame(syncRaf); syncRaf = requestAnimationFrame(sync); };

// ---------- doing things ----------
function open(url: string, id = S.active): void {
  const t = S.tabs.find(x => x.id === id);
  if (!t || !url) return;
  editQuick = false;                // leaving the new-tab page ends its quick-link editing
  const l = liveOf(t.id);
  const first = !t.url;             // a tab with no page yet: its native page is made by show()
  t.url = url; t.title = ''; t.icon = '';
  l.error = null; l.loading = true; l.progress = 5;
  saveTabs();
  if (!first) { dropAsks(t.id); browser.navigate(t.id, url); }   // the page that asked is being replaced
  render();
}

function newTab(url = '', priv = false): Tab | null {
  if (S.tabs.length >= MAX_TABS) { flash('That’s the most tabs ClaudeOS keeps open'); return null; }
  const t: Tab = { id: newId(), url: '', title: '', icon: '', priv: priv || undefined };
  const i = S.tabs.findIndex(x => x.id === S.active);
  S.tabs.splice(i + 1, 0, t);
  S.active = t.id;
  saveTabs();
  if (url) open(url, t.id); else render();
  return t;
}

/** Closes a tab. With `undo`, a page that was open can come back (Undo, 5 seconds): it loads its address again. */
function closeTab(id: string, undo = true): void {
  const i = S.tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const gone = S.tabs[i];
  dropAsks(id);
  browser.close(id);
  S.live.delete(id);
  S.tabs.splice(i, 1);
  if (!S.tabs.length) S.tabs.push({ id: newId(), url: '', title: '', icon: '' });
  if (S.active === id) S.active = S.tabs[Math.min(i, S.tabs.length - 1)].id;
  saveTabs();
  render();
  if (undo && gone.url) showUndo(`Closed ${gone.title || host(gone.url)}`, () => restoreTab(gone, i));
}

/** Puts a closed tab back where it was, with its address; its page is made again (a new tab id). */
function restoreTab(gone: Tab, at: number): void {
  if (S.tabs.length >= MAX_TABS) { flash('That’s the most tabs ClaudeOS keeps open'); return; }
  const url = gone.url;
  // closing the last tab left a blank one: the restored tab takes its place
  if (S.tabs.length === 1 && !S.tabs[0].url) { S.live.delete(S.tabs[0].id); S.tabs = []; }
  gone.id = newId(); gone.url = ''; gone.title = ''; gone.icon = '';   // no url yet: show() makes the page, not navigate
  S.tabs.splice(Math.min(at, S.tabs.length), 0, gone);
  S.active = gone.id;
  saveTabs();
  open(url, gone.id);
}

/** Takes the current tab's page down (its native page is closed) and leaves the tab on the new-tab page under a new id;
 *  the next show() makes the page when a page is opened in the tab. */
function resetTab(t: Tab): void {
  dropAsks(t.id);
  browser.close(t.id); S.live.delete(t.id);
  t.id = newId(); t.url = ''; t.title = ''; t.icon = '';
  S.active = t.id;
}

/** Home: the page goes, and the new-tab page shows in this tab. The page is kept in the tab's `past`, so Back returns. */
function goHome(): void {
  const t = cur();
  if (!t.url) return;
  t.past = [...(t.past || []), t.url].slice(-MAX_PAST);
  resetTab(t);
  nativeOn = true;     // sync() hides the native page, which is closed already
  saveTabs(); render();
}

/** Back in the current tab: the page's own history first, then the page that Home put away. False when there is none. */
function goBack(): boolean {
  const t = cur(), l = liveOf(t.id);
  if (t.url && l.back) { browser.back(t.id); return true; }
  const u = t.past?.pop();
  if (!u) return false;
  resetTab(t);         // the page here goes; the one Home put away is made again at its address
  saveTabs();
  open(u, t.id);
  return true;
}

function select(id: string): void {
  if (id === S.active) return;
  const prev = cur();
  if (prev.url && shown) browser.snapshot(prev.id);   // a picture of the page it leaves, for the tab overview
  S.active = id;
  saveTabs();
  render();
}

function editAddress(): void {
  const t = cur();
  editing = true;
  renderSuggest(t.url);
  renderContent();
  Keyboard.open({
    value: t.url, placeholder: `Search ${ENGINES[S.engine].label} or type an address`, max: 400,
    onChange: text => renderSuggest(text),
    onDone: text => { const u = resolveInput(text); editing = false; if (u) open(u); return true; },
    onClose: () => { editing = false; renderContent(); },
  });
}

function addQuick(): void {
  Keyboard.open({
    placeholder: 'Address, like wikipedia.org', max: 300,
    onDone: text => {
      const url = resolveInput(text);
      if (!url || !/^https?:\/\/[^/]*\./.test(url) || url.startsWith(ENGINES[S.engine].q)) { flash('That doesn’t look like an address'); return false; }
      setTimeout(() => Keyboard.open({
        value: host(url).split('.')[0].replace(/^./, c => c.toUpperCase()), placeholder: 'Name', autoCap: true, max: 24,
        onDone: name => { S.quick.push({ title: name.trim() || host(url), url }); saveQuick(); renderNtp(); },
      }), 0);
      return true;
    },
  });
}

// ---------- what the tablet tells us ----------
/** The error page for a failed load. The tablet's `retryable` flag says whether Try again can help; the message words
 *  pick the wording, and decide the retry only for an older tablet build that sends no flag. */
function errorText(e: BrowserEvent): { title: string; body: string; retry: boolean } {
  const m = (e.message || '').toUpperCase();
  const retry = (fallback: boolean) => typeof e.retryable === 'boolean' ? e.retryable : fallback;
  if (m.includes('GOOGLE_SIGNIN_REJECTED')) return { title: 'Google blocked sign-in here.', body: 'Set Google sign-in to the Chrome panel in Browser settings, then open this page again.', retry: false };
  if (m.includes('NAME_NOT_RESOLVED') || m.includes('HOST_LOOKUP')) return { title: 'That address didn’t lead anywhere.', body: `ClaudeOS couldn’t find ${host(e.url || '')}. Check the spelling, or search for it instead.`, retry: retry(true) };
  if (m.includes('INTERNET_DISCONNECTED') || m.includes('NETWORK_CHANGED')) return { title: 'No connection right now.', body: 'The tablet seems to be offline. Check Wi-Fi in the control center, then try again.', retry: retry(true) };
  // only a public plain-http page the Browser refused (BrowserView shouldInterceptRequest) says "isn't secure"
  if (m.includes('CLEARTEXT_BLOCKED')) return { title: 'That page isn’t secure.', body: 'This site only offers an unencrypted connection, so ClaudeOS didn’t open it. Go back, or try another address.', retry: false };
  if (m.includes('SSL') || m.includes('CERT')) return { title: 'That secure page didn’t check out.', body: `${host(e.url || '') || 'The site'} has a security certificate ClaudeOS can’t trust, so it wasn’t opened. Go back, or try another address.`, retry: false };
  if (e.retryable === false) return { title: 'That page didn’t load.', body: `${host(e.url || '') || 'The site'} can’t be opened this way. Go back, or try another address.`, retry: false };
  return { title: 'That page didn’t load.', body: `${host(e.url || '') || 'The site'} didn’t answer the way it should. It may be down for a moment.`, retry: retry(true) };
}

/** A download's progress and end (the tablet's DownloadManager). Finished and failed ones tell the user with a banner. */
function onDownload(e: BrowserEvent): void {
  const id = e.id ?? 0;
  let d = dlByKey(id, e.uri ?? '');
  let changed = false;
  if (!d && e.state !== 'failed' && e.state !== 'gone') {
    d = { id, uri: e.uri ?? '', name: e.name || 'Download', mime: e.mime || '', bytes: 0, total: 0, state: 'running', at: Date.now() };
    S.downloads.unshift(d);
    S.downloads = S.downloads.slice(0, MAX_DL);
    changed = true;
    if (e.state === 'start') flash(`Downloading ${d.name}`);
  }
  if (!d) return;
  if (e.name) d.name = e.name;
  if (e.mime) d.mime = e.mime;
  if (e.bytes != null) d.bytes = e.bytes;
  if (e.total != null && e.total > 0) d.total = e.total;
  if (e.uri) d.uri = e.uri;
  switch (e.state) {
    case 'done':
      d.state = 'done'; d.at = Date.now(); changed = true;
      ctx.notify({ title: 'Download finished', body: d.name });
      break;
    case 'failed':
      d.state = 'failed'; d.message = e.message || 'The download didn’t finish'; changed = true;
      ctx.notify({ title: 'Download didn’t finish', body: d.name });
      break;
    case 'gone': d.state = 'gone'; changed = true; break;
    case 'running': d.state = 'running'; break;
    default: break;
  }
  if (changed) saveDownloads();
  downloadsChanged();
}

function onEvent(e: BrowserEvent): void {
  if (e.type === 'chrome') { chromeEvent(e); return; }
  if (panelEvent(e)) return;                       // chooser, long-press, reader, site permission, find
  if (e.type === 'download') { onDownload(e); return; }
  if (e.type === 'message') { if (e.message) flash(e.message); return; }
  if (e.type === 'newtab') { if (e.url && /^https?:/.test(e.url)) newTab(e.url); return; }
  const t = S.tabs.find(x => x.id === e.tab);
  if (!t) return;
  const l = liveOf(t.id);
  switch (e.type) {
    case 'url':
      if (e.url) { if (e.url !== t.url) { if (t.url) dropAsks(t.id); t.icon = ''; t.title = ''; } t.url = e.url; if (!t.priv) visit(e.url, t.title); }
      l.back = !!e.canGoBack; l.fwd = !!e.canGoForward;
      break;
    case 'title':
      t.title = e.title || '';
      if (!t.priv && S.history[0]?.url === t.url) { S.history[0].title = t.title; saveHistory(); }
      break;
    case 'favicon': t.icon = e.icon || ''; break;
    case 'progress':
      l.progress = e.progress ?? l.progress; l.loading = !!e.loading;
      if (e.loading && l.progress < 15) l.error = null;
      if (e.canGoBack != null) { l.back = e.canGoBack; l.fwd = !!e.canGoForward; }
      break;
    case 'error':
      l.loading = false;
      l.error = errorText(e);
      if (e.canGoBack != null) { l.back = e.canGoBack; l.fwd = !!e.canGoForward; }   // the error page's Back needs this
      break;
    case 'blocked': flash(e.message || 'That link wants another app. ClaudeOS stays here.'); break;
    case 'zoom':
      l.zoom = e.percent ?? 100;
      if (t.id === S.active) { flash(`Zoom ${l.zoom}%`); zoomChanged(l.zoom); }
      break;
    case 'thumb': l.thumb = e.image || ''; overviewChanged(); break;
    default: break;
  }
  saveTabs();
  if (t.id === S.active) render(); else renderTabs();
}

/** Google sign-in opened or closed in Chrome's side sheet (BrowserView.java). While it is open, the native page
 *  steps aside (sync), this app shows a short note with a Done button, and the whole stage is fitted into the space
 *  left of the sheet (setStageInset), so nothing of Claude Home is under it. On close the stage glides back, and the
 *  native page is placed again once it has settled ('hub:stage'), not at a rectangle from mid-glide. */
function chromeEvent(e: BrowserEvent): void {
  chromeOpen = e.state === 'open';
  $('brChrome').hidden = !chromeOpen;
  let moving: boolean;
  if (chromeOpen) {
    const d = devicePixelRatio || 1;
    const vw = window.visualViewport ? window.visualViewport.width * window.visualViewport.scale : innerWidth;
    // the sheet's left edge in CSS px; an older app build sends none: the sheet takes about the right half
    const left = typeof e.left === 'number' && e.left > 0 ? e.left / d : vw * 0.55;
    moving = setStageInset(Math.max(0, vw - left));
  } else {
    moving = setStageInset(0);
  }
  if (chromeOpen || !moving) sync();   // closing with a glide: the 'hub:stage' listener syncs at the end
}

/** A link another app sent to Claude Home: a new tab in the Browser. At the tab limit the oldest tab that is neither
 *  the current one nor private makes room; if there is none, the current page stays and the link is not opened. */
function takeIncoming(): void {
  const url = browser.incoming();
  if (!url) return;
  ctx.requestAttention();
  if (S.tabs.length < MAX_TABS) { newTab(url); return; }
  const old = S.tabs.find(t => t.id !== S.active && !t.priv);
  if (!old) { flash('That’s the most tabs ClaudeOS keeps open'); return; }
  closeTab(old.id, false);
  newTab(url);
  flash('Closed your oldest tab to open this link');
}

// ---------- Claude control: browser_open and browser_back (claude/web/browser-relay.ts) ----------
// Both use the same functions as the address bar and the Back button, bring the Browser on screen (the native page
// is only made and shown while the app is on screen), and wait a little for the page so that the next read works.
type Said = { ok: boolean; data: string };
const OPEN_WAIT_MS = 12e3, BACK_WAIT_MS = 8e3;   // under the server's 20 s for a call
const NOT_SHOWN = 'The Browser couldn’t come on screen (the tablet may be locked). Ask the user to unlock it, then try again.';

/** Waits until tab t's page has loaded or failed (after `moved`), the tab went away, or ms passed. */
async function settled(t: Tab, ms: number, moved: () => boolean = () => true): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!S.tabs.includes(t)) return;
    const l = liveOf(t.id);
    if (l.error || (moved() && !l.loading)) return;
    await new Promise(r => setTimeout(r, 200));
  }
}

/** The end of an answer about tab t: its title, a note while it still loads, or the error. */
function pageState(t: Tab): Said {
  const l = liveOf(t.id);
  if (!S.tabs.includes(t)) return { ok: false, data: 'The tab was closed before the page loaded.' };
  if (l.error) return { ok: false, data: `${l.error.title} ${l.error.body}`.trim() };
  if (l.loading) return { ok: true, data: ' It is still loading; read the page in a moment.' };
  return { ok: true, data: t.title ? ` The page is titled “${t.title}”.` : '' };
}

/** Lets the native page show: the address keyboard and the Browser's own panels go. */
function clearForPage(): void {
  if (editing && Keyboard.isOpen) Keyboard.close('nav');
  editing = false;
  for (let i = 0; i < 6 && panelOpen() && backClosesPanel(); i++) { /* one panel each time */ }
}

async function claudeOpen(text: string): Promise<Said> {
  const r = reading(text);   // the address bar's rules: an address gets https:// (http:// for local hosts), anything else searches
  let u: URL | null = null;
  try { u = new URL(r.url); } catch { u = null; }
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return { ok: false, data: 'The Browser only opens http and https addresses.' };
  if (u.username || u.password) return { ok: false, data: 'The Browser won’t open an address with a name or password in it.' };
  // a new tab; the current tab is used when it is an empty one (the new-tab page with nothing to go back to)
  const c = cur();
  let t: Tab | null;
  if (!c.url && !c.past?.length && !c.priv) { t = c; open(r.url, t.id); }
  else t = newTab(r.url);
  if (!t) return { ok: false, data: `Couldn’t open it: the Browser already has ${MAX_TABS} tabs open, the most it keeps. Ask the user to close one.` };
  report('browser:claude-open');
  clearForPage();
  openApp(manifest.id);
  if (!shown) return { ok: false, data: `${host(r.url)} is in a new Browser tab, but it won’t load until the Browser is on screen. ${NOT_SHOWN}` };
  render();
  const said = r.search ? `Searched ${host(r.url)} for “${text.trim()}” in the Browser.` : `Opened ${host(r.url)} in the Browser.`;
  if (!browser.available) return { ok: true, data: said };   // no native pages here (mock, a normal browser)
  await settled(t, OPEN_WAIT_MS);
  const end = pageState(t);
  if (!end.ok) return { ok: false, data: `Couldn’t open ${host(t.url || r.url)}: ${end.data}` };
  const moved = t.url && host(t.url) !== host(r.url) ? ` It went on to ${host(t.url)}.` : '';
  return { ok: true, data: said + moved + end.data };
}

async function claudeBack(): Promise<Said> {
  const t = cur(), l = liveOf(t.id);
  if (!canBack(t, l)) return { ok: false, data: t.url ? `The Browser can’t go back: ${host(t.url)} is the first page in this tab.` : 'The Browser’s current tab has no page to go back to.' };
  clearForPage();
  openApp(manifest.id);
  if (!shown) return { ok: false, data: NOT_SHOWN };
  const before = t.url;
  if (!goBack()) return { ok: false, data: 'The Browser’s current tab has no page to go back to.' };
  render();
  if (!browser.available) return { ok: true, data: `Went back to ${host(t.url)} in the Browser.` };
  await settled(t, BACK_WAIT_MS, () => t.url !== before);
  const end = pageState(t);
  if (!end.ok) return { ok: false, data: `Went back, but the page didn’t load: ${end.data}` };
  return { ok: true, data: `Went back to ${host(t.url)} in the Browser.${end.data}` };
}

// ---------- settings ----------
function permissionRows(): SettingRow[] {
  const hosts = Object.keys(S.perms).filter(h => PERM_KINDS.some(k => S.perms[h][k]));
  if (!hosts.length) return [{ kind: 'info', id: 'perms', title: 'Site permissions', detail: 'Camera, microphone and location, asked per site', value: () => 'None yet' }];
  return hosts.map((h): SettingRow => {
    const p: Perms[string] = S.perms[h];
    const detail = PERM_KINDS.filter(k => p[k]).map(k => `${PERM_LABEL[k]} ${p[k] === 'allow' ? 'allowed' : 'blocked'}`).join(' · ');
    return { kind: 'action', id: `perm:${h}`, title: h, detail, label: 'Forget', run: () => { delete S.perms[h]; savePerms(); appSettingsChanged(); } };
  });
}

// ---------- settings: History > Clear asks first, as the History page does ----------
// The row becomes "Clear all" with a "Keep" row beside it; it goes back to "Clear" after a while if nothing is tapped.
let historyClearArmed = false;
let historyArmTimer = 0;

function disarmHistoryClear(): void {
  clearTimeout(historyArmTimer);
  if (!historyClearArmed) return;
  historyClearArmed = false;
  appSettingsChanged();
}

function armHistoryClear(): void {
  historyClearArmed = true;
  clearTimeout(historyArmTimer);
  historyArmTimer = window.setTimeout(disarmHistoryClear, 20000);
  appSettingsChanged();
}

function historyRows(): SettingRow[] {
  if (!historyClearArmed) return [{ kind: 'action', id: 'history', title: 'History', detail: 'The pages you opened',
    value: () => S.history.length ? `${S.history.length} page${S.history.length === 1 ? '' : 's'}` : 'Empty',
    disabled: () => !S.history.length, label: 'Clear', run: armHistoryClear }];
  return [
    { kind: 'action', id: 'history', title: 'Clear all of your history?', detail: 'This can’t be undone.', label: 'Clear all',
      run: () => { disarmHistoryClear(); S.history = []; saveHistory(); renderNtp(); appSettingsChanged(); report('browser:clear-history'); } },
    { kind: 'action', id: 'historyKeep', title: 'Keep your history', label: 'Keep', run: disarmHistoryClear },
  ];
}

// ---------- settings: Site data asks first too (it signs the user out of sites) ----------
let siteDataArmed = false;
let siteDataTimer = 0;

function disarmSiteData(): void {
  clearTimeout(siteDataTimer);
  if (!siteDataArmed) return;
  siteDataArmed = false;
  appSettingsChanged();
}

function armSiteData(): void {
  siteDataArmed = true;
  clearTimeout(siteDataTimer);
  siteDataTimer = window.setTimeout(disarmSiteData, 20000);
  appSettingsChanged();
}

function siteDataRows(): SettingRow[] {
  if (!siteDataArmed) return [{ kind: 'action', id: 'data', title: 'Site data', detail: 'Cookies, sign-ins and saved files of the sites you visited',
    label: 'Clear', run: armSiteData }];
  return [
    { kind: 'action', id: 'data', title: 'Clear site data?', detail: 'You’ll be signed out of your sites. This can’t be undone.', label: 'Clear all',
      run: () => { disarmSiteData(); browser.clearData(); report('browser:clear-data'); } },
    { kind: 'action', id: 'dataKeep', title: 'Keep your site data', label: 'Keep', run: disarmSiteData },
  ];
}

// ---------- the app ----------
function mount(c: AppContext): void {
  ctx = c;
  // each saved list is read field by field: a value that is not a list, or an entry that fails its check, is left out
  const saved = readJson<{ active?: unknown; tabs?: unknown } | null>(K.tabs, null);
  S.tabs = Array.isArray(saved?.tabs) ? (saved!.tabs as unknown[]).filter(hasStringId).slice(0, MAX_TABS) as Tab[] : [];
  if (!S.tabs.length) S.tabs = [{ id: newId(), url: '', title: '', icon: '' }];
  S.active = saved && typeof saved.active === 'string' && S.tabs.some(t => t.id === saved.active) ? saved.active : S.tabs[0].id;
  S.history = readSavedList<Visit>(store.get(K.history), isVisit) ?? [];
  S.bookmarks = readSavedList<Bookmark>(store.get(K.bookmarks), hasUrl) ?? [];
  S.downloads = readSavedList<Dl>(store.get(K.downloads), hasNumberId) ?? [];
  S.quick = readSavedList<Quick>(store.get(K.quick), hasUrl, MAX_QUICK) ?? DEFAULT_QUICK;
  S.perms = readSavedObject<Perms>(store.get(K.perms)) ?? {};
  const eng = store.get(K.engine);
  S.engine = (Object.keys(ENGINES) as Engine[]).find(e => e === eng) || 'duckduckgo';

  initPanels({
    ctx, sel: cur, open, newTab, select, closeTab, flash, render, sync,
    notify: (title, body) => ctx.notify({ title, body }),
    shown: () => shown,
  });
  browser.on(onEvent);
  // the hub's Back (system.ts priority stack, below the shell's overlays, above Home): sheets and dialogs, then full
  // pages, then the find bar, then one step back in the current tab; otherwise false, and Back goes Home
  onBack(() => {
    if (!shown) return false;
    if (backClosesPanel()) return true;
    return goBack();
  }, 20);
  onResume(takeIncoming);
  provideControl({ open: claudeOpen, back: claudeBack });
  (window as unknown as { hubBrowserIncoming: () => void }).hubBrowserIncoming = takeIncoming;
  reconcileDownloads();

  $('brTabs').addEventListener('click', e => {
    const el = e.target as Element;
    const x = el.closest<HTMLElement>('[data-close]');
    if (x) { closeTab(x.dataset.close!); report('browser:close-tab'); return; }
    const tab = el.closest<HTMLElement>('[data-tab]');
    if (tab) select(tab.dataset.tab!);
  });
  $('brNew').addEventListener('click', () => { newTab(); report('browser:new-tab'); });
  $('brOverviewBtn').addEventListener('click', () => panels.overview());
  $('brBack').addEventListener('click', () => { goBack(); });
  $('brFwd').addEventListener('click', () => browser.forward(S.active));
  $('brReload').addEventListener('click', () => {
    const l = liveOf(S.active);
    if (l.loading) browser.stop(S.active);
    else { l.error = null; browser.reload(S.active); render(); }
  });
  $('brStar').addEventListener('click', () => { toggleBookmark(); report('browser:bookmark'); });
  $('brMore').addEventListener('click', () => { panels.menu(); report('browser:menu'); });
  // Claude in the Browser: the side panel (claude-panel.ts); opening it fits the page to the space left of it
  initClaudePanel(id => $(id), () => syncSoon());   // also wires the bar's Claude button; a missing panel is skipped
  applyHeader();
  $('brHome').addEventListener('click', goHome);
  $('brNtpBack').addEventListener('click', () => { goBack(); });
  $('brAddr').addEventListener('click', editAddress);
  $('brSearch').addEventListener('click', editAddress);
  $('brRetry').addEventListener('click', () => { const l = liveOf(S.active); l.error = null; l.loading = true; browser.reload(S.active); render(); });
  $('brMsgHome').addEventListener('click', () => $('brHome').click());
  $('brMsgBack').addEventListener('click', () => { liveOf(S.active).error = null; goBack(); render(); });
  $('brChromeDone').addEventListener('click', () => browser.chromeDone());
  $('brEdit').addEventListener('click', () => { editQuick = !editQuick; renderNtp(); });
  $('brSeeHistory').addEventListener('click', () => panels.history());
  $('brQuick').addEventListener('click', e => {
    const el = e.target as Element;
    const x = el.closest<HTMLElement>('[data-qx]');
    if (x) {
      const i = +x.dataset.qx!, gone = S.quick[i];
      if (!gone) return;
      S.quick.splice(i, 1); saveQuick(); renderNtp();
      showUndo(`Removed ${gone.title || host(gone.url)}`, () => { S.quick.splice(Math.min(i, S.quick.length), 0, gone); saveQuick(); renderNtp(); });
      return;
    }
    if (el.closest('[data-qadd]')) { addQuick(); return; }
    const q = el.closest<HTMLElement>('[data-q]');
    if (q && !editQuick) { open(S.quick[+q.dataset.q!].url); report('browser:quick'); }
  });
  const goRow = (e: Event) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-url]');
    if (!b) return;
    if (Keyboard.isOpen) { editing = false; Keyboard.close('chosen'); }
    open(b.dataset.url!);
  };
  $('brRecent').addEventListener('click', goRow);
  $('brSuggest').addEventListener('click', goRow);

  // anything of Claude Home's that comes over the content area hides the native page meanwhile
  addEventListener('hub:cover', e => { coverExternal = Math.max(0, coverExternal + ((e as CustomEvent<boolean>).detail ? 1 : -1)); syncSoon(); });
  new MutationObserver(() => { if (shown || nativeOn) syncSoon(); })
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  new ResizeObserver(() => { if (shown) syncSoon(); }).observe($('brFrame'));
  addEventListener('resize', () => { if (shown) syncSoon(); });
  // the stage moved without resizing (fitted beside Chrome's sheet, or back): the native page follows
  addEventListener('hub:stage', () => { if (shown || nativeOn) syncSoon(); });

  registerAppSettings({
    app: manifest.id, name: manifest.name, icon: I.app, blurb: 'Search, downloads, site permissions and browsing data',
    rows: () => [
      { kind: 'choice', id: 'header', title: 'Header', options: [{ value: 'full', label: 'Full' }, { value: 'compact', label: 'Compact' }],
        get: () => headerVariant(), set: v => { store.set(K.header, v); applyHeader(); appSettingsChanged(); } },
      { kind: 'choice', id: 'engine', title: 'Search with', options: (Object.keys(ENGINES) as Engine[]).map(v => ({ value: v, label: ENGINES[v].label })),
        get: () => S.engine, set: v => { S.engine = v as Engine; store.set(K.engine, S.engine); renderNtp(); appSettingsChanged(); } },
      { kind: 'info', id: 'downloads', title: 'Downloads', detail: 'Saved in Download on the tablet, and listed in the Browser’s menu',
        value: () => S.downloads.length ? `${S.downloads.length} file${S.downloads.length === 1 ? '' : 's'}` : 'None yet' },
      { kind: 'info', id: 'default', title: 'Default browser', detail: 'Links from other apps open in the Browser',
        value: () => 'ClaudeOS' },
      { kind: 'choice', id: 'google', title: 'Google sign-in', detail: 'Chrome panel signs in with Chrome’s own cookies. In this browser, Google may refuse.',
        options: [{ value: 'chrome', label: 'Chrome panel (recommended)' }, { value: 'browser', label: 'In this browser' }],
        get: () => browser.googleSigninInChrome() ? 'chrome' : 'browser',
        set: v => { browser.setGoogleSigninInChrome(v === 'chrome'); appSettingsChanged(); } },
      ...permissionRows(),
      ...historyRows(),
      ...siteDataRows(),
    ],
  });

  render();
  takeIncoming();
}

const app: HubApp = {
  ...manifest,
  icon: I.app,
  mount,
  onShow() {
    shown = true;
    render();
    // the page rises in as it opens: place the native page again once it has settled
    setTimeout(syncSoon, 260); setTimeout(syncSoon, 520);
  },
  onHide() {
    shown = false;
    if (editing && Keyboard.isOpen) Keyboard.close('nav');
    editing = false;
    browser.hide(); nativeOn = false;
  },
  onClose() {
    // closed in the app switcher: every tab's page goes, one fresh tab remains
    S.tabs.forEach(t => { dropAsks(t.id); browser.close(t.id); });
    S.live.clear();
    S.tabs = [{ id: newId(), url: '', title: '', icon: '' }];
    S.active = S.tabs[0].id; nativeOn = false; saveTabs();
    ctx.root.querySelectorAll('.br-over.on').forEach(o => o.classList.remove('on'));
    findReset(); hideUndo();
    render();
  },
};
export default app;
