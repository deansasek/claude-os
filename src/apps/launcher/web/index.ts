// The Apps screen: ClaudeOS's home screen, one grid the family arranges. The rail (Home, Apps, pins, open apps) is the dock.
//   One grid, in the saved order: ClaudeOS's own apps (installedApps() from the shell), each a card with the rail's line
//   icon in ink (Claude keeps its clay spark), and on the tablet the Android apps the user allowed (androidApps in
//   device.ts, Launcher.java), each with a small corner glyph: it opens another app, not ClaudeOS. A pin mark shows the
//   apps kept in the sidebar. The Nest Hub shows ClaudeOS's apps alone.
// Edit mode: hold a tile (500 ms, the finger still) or tap Edit. In edit mode drag a tile anywhere in the grid (the hold
// that started edit mode carries straight on into the drag), tap its eye to hide or show it, the pin to keep it in the
// sidebar, and (on the tablet) Add apps opens a sheet of the tablet's launchable apps (untick one to remove it; the same
// list as Settings › Apps). Done or Back leaves edit mode.
// The order and the hidden tiles are saved per screen on the PC (POST /api/launcher/layout, .launcher-layout.json),
// with local storage as the offline copy: when the PC can't be reached the copy is used, and sent once it can.
// Which Android apps are allowed is never part of the layout: that list stays on the tablet (lock task depends on it).
//
// While an Android app is open, BackButton (android/src/hub/kiosk/BackButton.java) draws the floating "back to Claude Home" button.
import { esc, getJson, renderSparks, report, store } from '../../../core/web/dom.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import { androidApps, onTablet, type AndroidApp } from '../../../core/web/device.ts';
import { motionMs, reducedMotion } from '../../../core/web/motion.ts';
import { installedApps, isPinned, launchAndroid, pinnable, setPinned, type AppContext, type HubApp } from '../../../core/web/shell.ts';
import { onBack, openApp, openSettings } from '../../../core/web/system.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import { appArt } from '../../../core/web/app-art.ts';
import { readLists } from '../../lists/web/readers.ts';
import { cleanLayout, type LauncherLayout, type LauncherLayoutResult, type LauncherScreen } from '../api.ts';
import { manifest } from '../manifest.ts';
import { searchAll, type Hit, type SearchSources } from './search.ts';

const ICON = appIcon('apps');
const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l16 16"/><path d="M9.8 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.3 7.4A15.5 15.5 0 0 0 2.5 12s3.5 6.5 9.5 6.5a9.3 9.3 0 0 0 4-.9"/></svg>';
const PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3.5h6l-1 6 3.5 3.5v1.5h-11V13L10 9.5z"/><path d="M12 14.5v6"/></svg>';
const TICK ='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 12.5l4.2 4.2 8.8-9.4"/></svg>';
// an arrow leaving a box: "this opens another app"
const EXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

// ---------- the saved layout (per screen: the tablet and the Nest Hub keep their own) ----------
const SCREEN: LauncherScreen = onTablet ? 'tablet' : 'hub';
const API = '/api/launcher/layout';
const LAYOUT_KEY = `launcher.layout.${SCREEN}`;     // the offline copy
const UNSYNCED_KEY = `${LAYOUT_KEY}.unsynced`;      // '1': the copy has changes the PC hasn't got yet
const EMPTY: LauncherLayout = { order: [], hidden: [] };

/** Clean a layout as the PC does (api.ts); Android keys of apps no longer allowed go once the tablet has said which are. */
const tidy = (raw: unknown): LauncherLayout | null => cleanLayout(raw, { noAndroid: SCREEN === 'hub', allowed: allowedNow() });
function loadCache(): LauncherLayout {
  try { return tidy(JSON.parse(store.get(LAYOUT_KEY) || 'null')) ?? { ...EMPTY }; } catch { return { ...EMPTY }; }
}
let layout: LauncherLayout = { ...EMPTY };
let unsynced = false;
const setUnsynced = (on: boolean): void => { unsynced = on; store.set(UNSYNCED_KEY, on ? '1' : null); };

/** Keep the change: the local copy at once, the PC shortly after (a burst of changes is sent once). */
function saveLayout(): void {
  layout = tidy(layout) ?? layout;
  store.set(LAYOUT_KEY, JSON.stringify(layout));
  setUnsynced(true);
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => { void push(); }, 400);
}
let pushTimer = 0;
async function push(): Promise<void> {
  const sent = JSON.stringify(layout);
  const allowed = allowedNow();
  try {
    const r = await fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ screen: SCREEN, layout, ...(allowed ? { allowed: [...allowed] } : {}) }),
    });
    // a server error (5xx) or a save the PC could not make is sent again later; any other refusal is final
    const j = (r.ok ? await r.json() : { ok: false, error: `HTTP ${r.status}`, retry: r.status >= 500 }) as LauncherLayoutResult;
    if (!j.ok && !j.retry) console.warn('launcher: the PC refused the layout:', j.error);
    if (JSON.stringify(layout) === sent && (j.ok || !j.retry)) setUnsynced(false);   // nothing changed while it was on its way
  } catch { /* the PC can't be reached: the local copy keeps it, and it is sent again when Apps next shows */ }
}
/** The PC's layout replaces the copy, unless the copy has changes of its own (then those are sent instead). */
async function pull(): Promise<void> {
  if (unsynced) { await push(); return; }
  let j: LauncherLayoutResult;
  try { j = await getJson<LauncherLayoutResult>(`${API}?screen=${SCREEN}`); } catch { return; }   // offline: the copy stands
  if (!j?.ok || unsynced || drag || press) return;
  if (!j.layout) {   // nothing on the PC yet: this screen's copy (from before the PC kept it) goes there
    if (layout.order.length || layout.hidden.length) await push();
    return;
  }
  const next = tidy(j.layout);
  if (!next || JSON.stringify(next) === JSON.stringify(layout)) return;
  layout = next;
  store.set(LAYOUT_KEY, JSON.stringify(layout));
  paint();
}

/** Items sorted by the saved order; ones never placed keep their natural order, after the placed ones. */
function sorted<T extends { key: string }>(items: T[]): T[] {
  const at = (k: string) => { const i = layout.order.indexOf(k); return i < 0 ? 1e6 : i; };
  return items.map((it, n) => ({ it, n })).sort((a, b) => (at(a.it.key) - at(b.it.key)) || (a.n - b.n)).map(x => x.it);
}

// ---------- state ----------
interface Tile { key: string; name: string; art: string; kind: 'own' | 'tab'; id: string }
let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);
let editing = false;
let tabApps: AndroidApp[] = [];
let tabOk = false;   // the tablet answered with its allowed apps (so keys of apps it no longer allows may go)
const tabletSection = androidApps.available;
/** The packages the tablet allows now, or undefined when it hasn't said (then no Android key is dropped). */
function allowedNow(): Set<string> | undefined { return tabletSection && tabOk ? new Set(tabApps.map(a => a.id)) : undefined; }

const safeIcon = (url: string) => (/^data:image\/(png|svg\+xml|webp|jpeg)[;,]/.test(url) ? url : '');

function ownTiles(): Tile[] {
  return installedApps().filter(a => a.id !== manifest.id)
    // Claude keeps its clay spark (the one accent); every other app wears its rail icon, in ink
    .map(a => {
      const claude = a.id === 'claude';
      return { key: `c:${a.id}`, name: a.name, art: `<span class="ln-svg${claude ? ' ln-claude' : ''}">${claude ? (appArt('claude') ?? a.icon) : a.icon}</span>`, kind: 'own' as const, id: a.id };
    });
}
function tabTiles(): Tile[] {
  return tabApps.map(a => {
    const src = safeIcon(a.icon);
    const art = src ? `<img class="ln-img" src="${esc(src)}" alt="">` : `<span class="ln-letter">${esc(a.name.slice(0, 1))}</span>`;
    return { key: `a:${a.id}`, name: a.name, art, kind: 'tab' as const, id: a.id };
  });
}
const allTiles = (): Tile[] => [...ownTiles(), ...(tabletSection ? tabTiles() : [])];

/** Edit mode: pin a Claude Home app to the sidebar (shell.ts keeps the pins). */
function pinHtml(t: Tile): string {
  const on = isPinned(t.id);
  return `<span class="ln-pin${on ? ' on' : ''}" data-pin role="button" aria-pressed="${on}" aria-label="${on ? 'Unpin' : 'Pin'} ${esc(t.name)} ${on ? 'from' : 'to'} the sidebar">${PIN}</span>`;
}
function tileHtml(t: Tile): string {
  const hidden = layout.hidden.includes(t.key);
  const pinned = t.kind === 'own' && isPinned(t.id);
  return `<button class="ln-tile${hidden ? ' off' : ''}" data-key="${esc(t.key)}" data-kind="${t.kind}" data-id="${esc(t.id)}" title="${esc(t.name)}"`
    + `${t.kind === 'tab' ? ' aria-description="Opens another app"' : ''}>`
    + `<span class="ln-art">${t.art}</span><span class="ln-name">${esc(t.name)}</span>`
    + (pinned ? `<span class="ln-pinmark" aria-hidden="true">${PIN}</span>` : '')
    + (t.kind === 'tab' ? `<span class="ln-ext" aria-hidden="true">${EXT}</span>` : '')
    + (t.kind === 'own' && pinnable(t.id) ? pinHtml(t) : '')
    + `<span class="ln-eye" data-eye role="button" aria-label="${hidden ? 'Show' : 'Hide'} ${esc(t.name)}">${hidden ? EYE_OFF : EYE}</span>`
    + `</button>`;
}

/** Every tile is always in the grid; hidden ones show only in edit mode (CSS). So starting edit mode never rebuilds the
 *  grid, and the tile under a holding finger stays the same element through the hold and the drag. */
function paint(): void {
  $('lnGrid').innerHTML = sorted(allTiles()).map(tileHtml).join('');
  renderSparks();   // the Claude spark's rays are drawn in at runtime
  setEditing(editing);
}
function setEditing(on: boolean): void {
  editing = on;
  ctx.root.classList.toggle('ln-editing', on);
  $('lnEditLabel').textContent = on ? 'Done' : 'Edit';
  $('lnEdit').setAttribute('aria-pressed', String(on));
  $('lnHint').hidden = !on;
  $('lnAdd').hidden = !(on && tabletSection);
  paintEmpty();
}

/** The empty message. Edit mode and a search with results hide it, unless the tablet has no apps. */
function paintEmpty(): void {
  const on = editing;
  const tiles = [...$('lnGrid').querySelectorAll<HTMLElement>('.ln-tile')];
  const empty = $('lnEmpty');
  if (tiles.length && !on && tiles.every(t => t.classList.contains('off'))) {
    empty.textContent = 'Every app is hidden. Tap Edit to bring some back.';
    empty.hidden = false;
  } else if (tabletSection && !tabApps.length) {
    empty.textContent = on ? 'Tap Add apps to pick apps from this tablet for ClaudeOS to open.'
      : 'Nothing from the tablet here yet. Tap Edit, then Add apps, and pick a few for ClaudeOS to open.';
    empty.hidden = false;
  } else empty.hidden = true;
}

function loadTablet(): void {
  if (!tabletSection) return;
  try { tabApps = androidApps.allowed(); tabOk = true; } catch (e) { console.warn('launcher: allowed apps', e); tabApps = []; tabOk = false; }
}

// ---------- opening ----------
function launch(tile: HTMLElement): void {
  const { kind, id } = tile.dataset;
  if (!id) return;
  report(`launcher:${kind}:${id}`);
  if (kind === 'own') { openApp(id); return; }
  const a = tabApps.find(x => x.id === id);
  if (a) launchAndroid(a);   // a failure shows the shell's ClaudeOS banner (shell.ts launchAndroid); the shell lists it in the rail as open
}

// ---------- gestures ----------
// Out of edit mode: a tap opens the app. A hold (HOLD_MS with the finger within SLOP px) starts edit mode and lifts that
// tile, so the same finger drags it on. Moving more than SLOP first is a scroll: the hold is off.
// In edit mode: a tile follows the finger once it has moved DRAG_PX; the tiles it passes over make room. The eye and the
// pin are taps, never drags. Near the top or bottom edge the grid scrolls by itself.
const HOLD_MS = 500, SLOP = 10, DRAG_PX = 8, EDGE = 64;
let press: { tile: HTMLElement; id: number; x0: number; y0: number; x: number; y: number; timer: number } | null = null;
let drag: { tile: HTMLElement; id: number; x0: number; y0: number; x: number; y: number; gx: number; gy: number; lifted: boolean } | null = null;
let swallowClick = false;   // the press that just ended was a hold or a drag: its click is not a tap
let scrollRaf = 0;
const settling = new Set<Element>();   // tiles gliding to a new place: not a drop target until they arrive

const grid = (): HTMLElement => $('lnGrid');
/** A tile's place in its grid cell, in screen px (no transform or press scale), and the stage's scale (fitStage). */
function slot(tile: HTMLElement): { x: number; y: number; k: number } {
  const g = grid(), r = g.getBoundingClientRect();
  const k = r.width / (g.offsetWidth || 1) || 1;
  return { x: r.left + tile.offsetLeft * k, y: r.top + tile.offsetTop * k, k };
}
/** How far a lifted tile rises: --rise (0 with reduced motion, core.css), and none with Settings' reduce motion. */
const rise = (): number => (reducedMotion() ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rise')) || 0);

function cancelPress(): void {
  if (!press) return;
  clearTimeout(press.timer);
  press = null;
}
function onPointerDown(e: PointerEvent): void {
  if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0) || drag) return;
  swallowClick = false;
  cancelPress();
  const t = e.target as HTMLElement;
  if (t.closest('[data-eye], [data-pin]')) return;
  const tile = t.closest<HTMLElement>('.ln-tile');
  if (!tile) return;
  if (editing) { armDrag(tile, e.pointerId, e.clientX, e.clientY); return; }
  const timer = window.setTimeout(onHold, HOLD_MS);
  press = { tile, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, timer };
}
function onHold(): void {
  const p = press;
  press = null;
  if (!p || !p.tile.isConnected) return;
  swallowClick = true;
  report('launcher:edit:hold');
  // measured before edit mode shows the hidden tiles and the hint, which can move this tile's cell
  armDrag(p.tile, p.id, p.x0, p.y0);
  drag!.x = p.x; drag!.y = p.y;
  setEditing(true);
  lift();
}
function armDrag(tile: HTMLElement, id: number, x: number, y: number): void {
  const s = slot(tile);
  drag = { tile, id, x0: x, y0: y, x, y, gx: x - s.x, gy: y - s.y, lifted: false };
}
function lift(): void {
  if (!drag) return;
  drag.lifted = true;
  drag.tile.classList.add('lift', 'full');
  try { $('lnBody').setPointerCapture(drag.id); } catch { /* a mouse already released, or a synthetic pointer */ }
  place();
  cancelAnimationFrame(scrollRaf);
  scrollRaf = requestAnimationFrame(edgeScroll);
}
/** Keep the lifted tile under the finger, wherever its cell is now. */
function place(): void {
  if (!drag) return;
  const s = slot(drag.tile);
  drag.tile.style.transform = `translate(${(drag.x - drag.gx - s.x) / s.k}px, ${(drag.y - drag.gy - s.y) / s.k - rise()}px)`;
}
/** The tile under the finger makes room: the lifted one takes its cell, the ones between glide over (FLIP). */
function reorderAt(x: number, y: number): void {
  if (!drag) return;
  const g = grid();
  const under = document.elementFromPoint(x, y)?.closest<HTMLElement>('.ln-tile');
  if (!under || under === drag.tile || under.parentElement !== g || settling.has(under)) return;
  const tiles = [...g.children] as HTMLElement[];
  const from = tiles.indexOf(drag.tile), to = tiles.indexOf(under);
  if (from < 0 || to < 0) return;
  const before = new Map(tiles.map(t => [t, [t.offsetLeft, t.offsetTop]] as const));
  g.insertBefore(drag.tile, from < to ? under.nextSibling : under);
  if (reducedMotion()) return;
  const ms = motionMs('--dur-base');
  for (const t of tiles) {
    if (t === drag.tile) continue;
    const [l, tp] = before.get(t)!;
    const dx = l - t.offsetLeft, dy = tp - t.offsetTop;
    if (!dx && !dy) continue;
    settling.add(t);
    t.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: ms, easing: 'cubic-bezier(.4, 0, .2, 1)' })
      .finished.finally(() => settling.delete(t)).catch(() => {});
  }
}
/** While a tile is lifted near the top or bottom of the grid, scroll towards that edge. */
function edgeScroll(): void {
  if (!drag?.lifted) return;
  const body = $('lnBody'), r = body.getBoundingClientRect();
  const k = r.height / (body.offsetHeight || 1) || 1;
  const near = drag.y > r.bottom - EDGE * k ? (drag.y - (r.bottom - EDGE * k)) / (EDGE * k)
    : drag.y < r.top + EDGE * k ? -((r.top + EDGE * k) - drag.y) / (EDGE * k) : 0;
  if (near) {
    const top = body.scrollTop;
    body.scrollTop += Math.max(-1, Math.min(1, near)) * 12;
    if (body.scrollTop !== top) { reorderAt(drag.x, drag.y); place(); }
  }
  scrollRaf = requestAnimationFrame(edgeScroll);
}
function onPointerMove(e: PointerEvent): void {
  if (press && e.pointerId === press.id) {
    press.x = e.clientX; press.y = e.clientY;
    // a finger that wanders is a scroll, not a hold
    if (Math.hypot(e.clientX - press.x0, e.clientY - press.y0) > SLOP) cancelPress();
  }
  if (!drag || e.pointerId !== drag.id) return;
  drag.x = e.clientX; drag.y = e.clientY;
  if (!drag.lifted) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_PX) return;
    swallowClick = true;
    lift();
  }
  e.preventDefault();
  reorderAt(e.clientX, e.clientY);
  place();
}
function onPointerUp(e: PointerEvent): void {
  if (press && e.pointerId === press.id) cancelPress();
  if (!drag || e.pointerId !== drag.id) return;
  endDrag();
  if (swallowClick) setTimeout(() => { swallowClick = false; }, 400);   // the click that follows this pointerup
}
/** Drop: the tile glides into its cell and the order on screen becomes the saved order. */
function endDrag(): void {
  const d = drag;
  drag = null;
  cancelAnimationFrame(scrollRaf);
  if (!d?.lifted) return;
  const { tile } = d;
  const from = tile.style.transform;
  tile.style.transform = '';
  tile.classList.remove('lift', 'full');
  try { $('lnBody').releasePointerCapture(d.id); } catch { /* already released */ }
  if (from && !reducedMotion()) {
    tile.classList.add('drop');
    tile.animate([{ transform: from }, { transform: 'none' }], { duration: motionMs('--dur-base'), easing: 'cubic-bezier(.16, 1, .3, 1)' })
      .finished.finally(() => tile.classList.remove('drop')).catch(() => {});
  }
  saveOrderFromDom();
}
/** While Apps scrolls or drags after a hold, the browser must not take the touch for a scroll of its own. */
function onTouchMove(e: TouchEvent): void {
  if (drag?.lifted && e.cancelable) e.preventDefault();
}

// ---------- edit mode: hide / show, the order ----------
function toggleHidden(key: string): void {
  layout.hidden = layout.hidden.includes(key) ? layout.hidden.filter(k => k !== key) : [...layout.hidden, key];
  saveLayout();
  paint();
}
/** The order on screen becomes the saved order (keys of apps not on screen keep their place after it). */
function saveOrderFromDom(): void {
  const keys = [...grid().querySelectorAll<HTMLElement>('.ln-tile')].map(t => t.dataset.key!);
  layout.order = [...keys, ...layout.order.filter(k => !keys.includes(k))];
  saveLayout();
}
function stopEditing(): void {
  if (drag) endDrag();
  cancelPress();
  setEditing(false);
}

// ---------- the picker sheet ----------
let launchable: AndroidApp[] = [];
function paintList(): void {
  const allowed = new Set(tabApps.map(a => a.id));
  $('lnList').innerHTML = launchable.length ? launchable.map(a => {
    const src = safeIcon(a.icon), on = allowed.has(a.id);
    return `<button class="ln-row${on ? ' on' : ''}" data-pkg="${esc(a.id)}">`
      + (src ? `<img src="${esc(src)}" alt="">` : `<span class="ln-letter">${esc(a.name.slice(0, 1))}</span>`)
      + `<span class="ln-row-name">${esc(a.name)}</span><span class="ln-tick">${TICK}</span></button>`;
  }).join('') : '<p class="ln-empty">No other apps found on the tablet.</p>';
}
function openSheet(): void {
  try { launchable = androidApps.launchable(); } catch (e) { console.warn('launcher: launchable', e); launchable = []; }
  launchable.sort((a, b) => a.name.localeCompare(b.name));
  paintList();
  $('lnSheet').hidden = false;
  requestAnimationFrame(() => $('lnSheet').classList.add('on'));
}
function closeSheet(): void {
  $('lnSheet').classList.remove('on');
  setTimeout(() => { $('lnSheet').hidden = true; }, 220);
}
/** Opens Google Play so apps can be installed there. Play is allowed first (ticked on the Apps screen, so it can be
 *  unticked again); it is a visible Android app, the one exception to the no-Android-UI rule for installs. */
const PLAY = 'com.android.vending';
function installApps(): void {
  try {
    const ids = tabApps.map(a => a.id);
    if (!ids.includes(PLAY)) { androidApps.setAllowed([...ids, PLAY]); loadTablet(); paint(); }
    const r = androidApps.launch(PLAY);
    if (!r?.ok) console.warn('launcher: Play did not open');
  } catch (e) { console.warn('launcher: install apps', e); }
}
function toggleAllowed(pkg: string): void {
  const ids = tabApps.map(a => a.id);
  const removing = ids.includes(pkg);
  const next = removing ? ids.filter(x => x !== pkg) : [...ids, pkg];
  try { androidApps.setAllowed(next); } catch (e) { console.warn('launcher: setAllowed', e); }
  loadTablet();
  // an app no longer allowed leaves the layout too (a new one joins at the end, unplaced, until it is moved)
  if (removing && tabOk && !tabApps.some(a => a.id === pkg)) saveLayout();
  paintList();
  paint();
}

// ---------- search (search.ts matches; lists and Claude sessions are read from the PC when search opens) ----------
let query = '';
let hits: Hit[] = [];
let lists: SearchSources['lists'] = [];
let sessions: SearchSources['sessions'] = [];
let loadedAt = 0;

async function loadSearchData(): Promise<void> {
  if (Date.now() - loadedAt < 60e3) return;   // read again at most once a minute
  loadedAt = Date.now();
  try {
    lists = (await readLists()).map(l => ({ id: l.id, name: l.name, items: l.items.map(i => i.text) }));
  } catch { lists = []; }
  try {
    const u = await getJson<{ sessions?: { id: string | null; title: string; folder: string }[] }>('/api/claude/usage');
    sessions = (u.sessions ?? []).filter(s => !!s.id).map(s => ({ id: s.id!, title: s.title, folder: s.folder }));
  } catch { sessions = []; }
  if (query) paintResults();
}

function sources(): SearchSources {
  return { apps: allTiles().map(t => ({ key: t.key, name: t.name })), lists, sessions };
}

/** The results replace the grid while a search has words in it. */
function paintResults(): void {
  const on = query.trim() !== '';
  hits = on ? searchAll(query, sources()) : [];
  $('lnGrid').hidden = on;
  $('lnResults').hidden = !on;
  $('lnResults').innerHTML = !on ? '' : hits.length
    ? hits.map((h, i) => `<button class="ln-result hit" data-hit="${i}"><b>${esc(h.label)}</b><span>${esc(h.sub)}</span></button>`).join('')
    : `<p class="ln-empty">Nothing matches “${esc(query)}”.</p>`;
  $('lnSearchText').textContent = query || 'Search';
  $('lnSearch').classList.toggle('has', on);
  $('lnSearchClear').hidden = !on;
  if (on) $('lnEmpty').hidden = true;
  else paintEmpty();
}

function clearSearch(): void {
  query = '';
  paintResults();
}

/** Open a result: an app, a Settings section, or the Lists or Claude app (which opens its own list or session screen). */
function openHit(h: Hit): void {
  report(`launcher:search:${h.kind}`);
  if (h.kind === 'app') {
    if (h.ref.startsWith('c:')) { openApp(h.ref.slice(2)); return; }
    const a = tabApps.find(x => `a:${x.id}` === h.ref);
    if (a) launchAndroid(a);
  } else if (h.kind === 'setting') openSettings(h.ref);
  else if (h.kind === 'list' || h.kind === 'item') openApp('lists');
  else if (h.kind === 'session') {
    // The Claude app opens the session named by hub:open-session (the same event Home uses).
    openApp('claude');
    dispatchEvent(new CustomEvent('hub:open-session', { detail: h.ref }));
  }
  else openApp('claude');
}

// ---------- mount ----------
function mount(context: AppContext): void {
  ctx = context;
  loadTablet();
  layout = loadCache();
  unsynced = store.get(UNSYNCED_KEY) === '1';
  paint();
  void pull();
  $('lnEdit').addEventListener('click', () => { if (editing) stopEditing(); else setEditing(true); report(`launcher:edit:${editing}`); });
  $('lnAdd').addEventListener('click', openSheet);
  $('lnSheetDone').addEventListener('click', closeSheet);
  $('lnInstall').addEventListener('click', installApps);
  $('lnShade').addEventListener('click', closeSheet);
  $('lnSearch').addEventListener('click', () => {
    void loadSearchData();
    Keyboard.open({
      value: query, placeholder: 'Search apps, settings, lists', done: 'Done', max: 40,
      onChange: text => { query = text; paintResults(); },
    });
  });
  $('lnSearchClear').addEventListener('click', clearSearch);
  $('lnResults').addEventListener('click', e => {
    const i = (e.target as HTMLElement).closest<HTMLElement>('[data-hit]')?.dataset.hit;
    if (i === undefined) return;
    const h = hits[+i];
    clearSearch();
    if (h) openHit(h);
  });
  // Back (system.ts): the Add apps sheet closes first, then edit mode ends (as Done does); then Home
  onBack(() => {
    if (!ctx.isVisible()) return false;
    if (!$('lnSheet').hidden && $('lnSheet').classList.contains('on')) { closeSheet(); return true; }
    if (editing) { stopEditing(); return true; }
    return false;
  }, 10);
  $('lnList').addEventListener('click', e => {
    const pkg = (e.target as HTMLElement).closest<HTMLElement>('[data-pkg]')?.dataset.pkg;
    if (pkg) toggleAllowed(pkg);
  });
  const body = $('lnBody');
  body.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const tile = t.closest<HTMLElement>('.ln-tile');
    if (!tile) return;
    if (swallowClick) { swallowClick = false; return; }   // that press was a hold or a drag, not a tap
    if (editing) {
      if (t.closest('[data-pin]')) { const id = tile.dataset.id!; setPinned(id, !isPinned(id)); report(`launcher:pin:${id}`); paint(); }
      else if (t.closest('[data-eye]')) toggleHidden(tile.dataset.key!);
      return;
    }
    launch(tile);
  });
  body.addEventListener('pointerdown', onPointerDown);
  body.addEventListener('touchmove', onTouchMove, { passive: false });
  body.addEventListener('contextmenu', e => e.preventDefault());   // a hold starts edit mode, not the system menu
  addEventListener('pointermove', onPointerMove, { passive: false });
  addEventListener('pointerup', onPointerUp);
  addEventListener('pointercancel', onPointerUp);
}
function onShow(): void { loadTablet(); paint(); void pull(); }
function onHide(): void {
  if (editing || drag) stopEditing();
  if (!$('lnSheet').hidden) closeSheet();
  if (Keyboard.isOpen) Keyboard.close('nav');
  if (query) clearSearch();
}

const app: HubApp = { ...manifest, icon: ICON, mount, onShow, onHide };
export default app;
