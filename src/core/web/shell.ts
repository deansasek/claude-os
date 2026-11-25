// The Hub shell: builds the rail from the app list, loads each app's view and styles,
// switches between apps, drifts home when idle, and reloads when the page is updated.
import { type AppHeader, renderAppHeader } from './app-header.ts';
import { $, esc, fitStage, getJson, mockDevice, params, renderSparks, report, store } from './dom.ts';
import { checkHitAreas } from './hit-guard.ts';
import { Keyboard, initKeyboard } from './keyboard.ts';
import { androidApps, onResume, type AndroidApp } from './device.ts';
import { initMotion, motionMs, reducedMotion } from './motion.ts';
import { initStatus, addStatus } from './status.ts';
import { initSwitcher, type SwitcherCard } from './switcher.ts';
import { lockShowing } from './lock.ts';
import { closeControlCenter, initSystem, notify, wake } from './system.ts';
import { initTheme } from './theme.ts';
import { reportHubCheck } from './hub-link.ts';
import { hiddenApps } from './focus-modes.ts';

/** The apps a focus mode hides right now (os.focusApps). */
const focusHidden = (): string[] => hiddenApps(store.get('os.focusApps'));

/** What the core hands an app when it mounts. */
export interface AppContext {
  root: HTMLElement;                                          // the app's <section id="app-<id>">
  header: AppHeader;                                          // the shared header: icon + name (core/web/app-header.ts)
  $<T extends Element = HTMLElement>(id: string): T;          // find an element inside this app only
  setBadge(on: boolean): void;                                // dot on the rail icon
  setRail(opts: { icon?: string; label?: string; busy?: boolean }): void;
  requestAttention(): void;                                   // bring this app on screen (wakes the ambient screen)
  isVisible(): boolean;
  /** A system banner (skipped while this app is on screen) that also stays in the control center. */
  notify(n: { title: string; body?: string }): void;
}

/** What an app gives the core. */
export interface HubApp {
  id: string;
  name: string;
  icon: string;                                               // rail icon (SVG markup), also the header's icon
  title?: string;                                             // the header's wordmark, if not the name
  mount(ctx: AppContext): void;
  onShow?(): void;
  onHide?(): void;
  /** Closed in the app switcher: go back to a fresh start (background work such as alarms keeps running). */
  onClose?(): void;
}

const IDLE_HOME_MS = 10 * 60e3;
let apps: HubApp[] = [];
let current: string | null = null;
let lastTouch = Date.now();

// ---------- the rail: Home + Apps, then pinned apps, then the apps opened since the page loaded ----------
// Home and Apps are always at the top; pins are saved (store 'rail.pins', edited on the Apps screen) and Claude
// is pinned by default. After those come the open apps, most recent first, Android apps launched from
// Claude Home included. Closing an app in the switcher (switcher.ts) takes it out of the open list.
const PIN_KEY = 'rail.pins';
let pins: string[] = [];
let opened: string[] = [];                         // keys, most recent first: app ids, or 'a:<package>'
const androidOpen = new Map<string, AndroidApp>(); // package → app, for Android apps launched from here
const ownBtns = new Map<string, HTMLElement>();
const androidBtns = new Map<string, HTMLElement>();
let railApps: HTMLElement | null = null;
const UNCLOSABLE = new Set(['home', 'claude']);

const fixedIds = () => apps.slice(0, 1).map(a => a.id).concat(apps.some(a => a.id === 'launcher') ? ['launcher'] : []);
function loadPins(): string[] {
  let p: unknown = null;
  try { p = JSON.parse(store.get(PIN_KEY) || 'null'); } catch { /* default */ }
  const list = Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : ['claude'];
  return list.filter(id => apps.some(a => a.id === id) && !fixedIds().includes(id));
}
/** Can this app be pinned to the rail? (Home and Apps are always there.) */
export function pinnable(id: string): boolean { return apps.some(a => a.id === id) && !fixedIds().includes(id); }
export function isPinned(id: string): boolean { return pins.includes(id); }
export function setPinned(id: string, on: boolean): void {
  if (!pinnable(id)) return;
  pins = on ? [...pins.filter(p => p !== id), id] : pins.filter(p => p !== id);
  store.set(PIN_KEY, JSON.stringify(pins));
  renderRail();
}

// ---------- rail reorder: hold a pinned item, then drag it up or down ----------
const HOLD_MS = 450;
let dragBtn: HTMLElement | null = null;   // the item under the finger; renderRail() does not glide it

/** Hold a pinned rail item for a moment, then drag it up or down. The order is saved as it changes.
 *  Leave the rail sideways to put the order back as it was before the drag. */
function initRailReorder(): void {
  const rail = railApps!;
  let s: { btn: HTMLElement; id: string; x: number; y: number; top: number; before: string[]; dragging: boolean; timer: number } | null = null;
  let justDragged = false;   // swallow the click that follows a drag

  const stop = (revert: boolean): void => {
    const cur = s;
    if (!cur) return;
    clearTimeout(cur.timer);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    cur.btn.style.touchAction = '';
    if (cur.dragging) {
      dragBtn = null;
      cur.btn.style.transform = '';
      justDragged = true;
      if (revert) { pins = cur.before; store.set(PIN_KEY, JSON.stringify(pins)); renderRail(); }
    }
    s = null;
  };
  const onUp = (): void => stop(false);
  const onMove = (e: PointerEvent): void => {
    const cur = s;
    if (!cur) return;
    if (!cur.dragging) {
      if (Math.hypot(e.clientX - cur.x, e.clientY - cur.y) > 10) stop(false);   // a scroll or a slide, not a hold
      return;
    }
    const r = rail.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right) { stop(true); return; }   // left the rail: put the order back
    // the pinned item under the finger gives its place to the dragged item
    const over = [...rail.querySelectorAll<HTMLElement>('.ri[data-app]')]
      .filter(b => !b.hidden && b !== cur.btn && pins.includes(b.dataset.app!))
      .find(b => { const br = b.getBoundingClientRect(); return e.clientY >= br.top && e.clientY < br.bottom; });
    if (over) {
      const from = pins.indexOf(cur.id), to = pins.indexOf(over.dataset.app!);
      if (from !== to) {
        pins = pins.filter(p => p !== cur.id);
        const at = pins.indexOf(over.dataset.app!) + (from < to ? 1 : 0);   // moving down: land after the item
        pins.splice(at, 0, cur.id);
        store.set(PIN_KEY, JSON.stringify(pins));
        renderRail();
      }
    }
    // the reorder moves the item's layout; the transform keeps it under the finger
    cur.btn.style.transform = `translateY(${e.clientY - cur.y - (cur.btn.offsetTop - cur.top)}px)`;
  };

  rail.addEventListener('pointerdown', e => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.ri[data-app]');
    const id = btn?.dataset.app;
    if (!btn || !id || e.button !== 0 || !pins.includes(id)) return;
    justDragged = false;
    btn.style.touchAction = 'none';   // the browser must not scroll the rail during the drag
    const cur = { btn, id, x: e.clientX, y: e.clientY, top: btn.offsetTop, before: [...pins], dragging: false, timer: 0 };
    cur.timer = window.setTimeout(() => {
      cur.dragging = true; dragBtn = btn;
    }, HOLD_MS);
    s = cur;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });
  rail.addEventListener('click', e => {
    if (justDragged) { e.stopPropagation(); e.preventDefault(); justDragged = false; }
  }, true);
  rail.addEventListener('contextmenu', e => e.preventDefault());   // a long press must not open the stock menu
}

function railKeys(): string[] {
  const fixed = fixedIds();
  const hidden = focusHidden();   // a focus mode takes its apps off the rail (they stay on the Apps screen only when shown)
  return [...fixed, ...pins, ...opened.filter(k => !fixed.includes(k) && !pins.includes(k))].filter(k => fixed.includes(k) || !hidden.includes(k));
}

function androidBtn(app: AndroidApp): HTMLElement {
  let btn = androidBtns.get(app.id);
  if (btn) return btn;
  btn = document.createElement('button');
  btn.className = 'ri ri-android'; btn.dataset.app = `a:${app.id}`;
  const src = /^data:image\/(png|svg\+xml|webp|jpeg)[;,]/.test(app.icon) ? app.icon : '';
  btn.innerHTML = `<span class="ri-icon">${src ? `<img src="${esc(src)}" alt="">` : `<span class="ri-letter">${esc(app.name.slice(0, 1))}</span>`}</span><span class="ri-label">${esc(app.name)}</span>`;
  btn.addEventListener('click', () => { report(`rail:android:${app.id}`); launchAndroid(app); });
  androidBtns.set(app.id, btn);
  return btn;
}
const androidIcon = (app: AndroidApp) => androidBtn(app).querySelector('.ri-icon')!.innerHTML;

/** Put the rail's items in order. Items that move glide to their new place (FLIP, transform only). */
function renderRail(): void {
  if (!railApps) return;
  const keys = railKeys();
  const want: HTMLElement[] = [];
  for (const k of keys) {
    if (k.startsWith('a:')) { const a = androidOpen.get(k.slice(2)); if (a) want.push(androidBtn(a)); }
    else { const b = ownBtns.get(k); if (b) want.push(b); }
  }
  const before = new Map<HTMLElement, number>();
  railApps.querySelectorAll<HTMLElement>('.ri').forEach(b => { if (b.isConnected && !b.hidden) before.set(b, b.offsetTop); });
  // hide what's left, then append in order (appending moves an element)
  [...ownBtns.values(), ...androidBtns.values()].forEach(b => { if (!want.includes(b)) { b.hidden = true; if (b.parentElement !== railApps) railApps!.appendChild(b); } });
  want.forEach(b => { b.hidden = false; railApps!.appendChild(b); });
  for (const b of [...androidBtns.values()]) if (!want.includes(b)) { b.remove(); androidBtns.forEach((v, k) => { if (v === b) androidBtns.delete(k); }); }
  if (!reducedMotion()) {
    want.forEach(b => {
      if (b === dragBtn) return;   // the item in hand follows the finger, not the glide
      const was = before.get(b);
      if (was == null) { b.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: motionMs('--dur-base'), easing: 'cubic-bezier(.2, .8, .2, 1)' }); return; }
      const d = was - b.offsetTop;
      if (d) b.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration: motionMs('--dur-slow'), easing: 'cubic-bezier(.16, 1, .3, 1)' });
    });
  }
  if (current) placePill(current, before.size > 0);
}

// The rail's active pill: one element that slides to the chosen item (core.css .rail-pill).
let pill: HTMLElement | null = null;
function placePill(id: string, animate: boolean): void {
  if (!pill) return;
  const btn = ownBtns.get(id);
  if (!btn || btn.hidden) { pill.classList.remove('on'); return; }
  if (!animate) pill.style.transition = 'none';
  pill.style.transform = `translate(${btn.offsetLeft}px, ${btn.offsetTop}px)`;
  pill.classList.add('on');
  if (!animate) { void pill.offsetWidth; pill.style.transition = ''; }
  // keep the active item in view when the rail scrolls (lots of open apps on the Nest Hub)
  const r = railApps!;
  if (btn.offsetTop < r.scrollTop || btn.offsetTop + btn.offsetHeight > r.scrollTop + r.clientHeight) r.scrollTo({ top: btn.offsetTop - 8, behavior: animate ? 'smooth' : 'auto' });
}

function markOpen(key: string): void { opened = [key, ...opened.filter(k => k !== key)]; }

function showApp(id: string): void {
  if (id === current || lockShowing()) return;   // nothing opens behind the PIN lock
  if (Keyboard.isOpen) Keyboard.close('nav');
  const prev = apps.find(a => a.id === current);
  current = id;
  markOpen(id);
  // pages cross-fade and the pill slides (core.css); nothing here waits for either, so a second tap acts at once
  document.querySelectorAll<HTMLElement>('.app').forEach(el => el.classList.toggle('on', el.id === `app-${id}`));
  document.querySelectorAll<HTMLElement>('.ri[data-app]').forEach(el => el.classList.toggle('on', el.dataset.app === id));
  renderRail();
  placePill(id, !!prev);
  store.set('app', id);
  if (prev?.onHide && !failed.has(prev.id)) guard(prev, 'onHide', () => prev.onHide!());
  const next = apps.find(a => a.id === id);
  if (next?.onShow && !failed.has(next.id)) guard(next, 'onShow', () => next.onShow!());
  if (mockDevice) setTimeout(checkHitAreas, 400);   // dev: the page as it now shows (hit-guard.ts)
}

/** Open an allowed Android app (the Apps screen, the rail, the switcher); it shows in the rail as open.
 *  Every failure (the tablet refused it, threw, or there is no tablet) gets the same ClaudeOS banner. */
export function launchAndroid(app: AndroidApp): boolean {
  if (lockShowing()) return false;   // nothing opens behind the PIN lock
  let ok = false;
  try { ok = !!androidApps.launch(app.id).ok; } catch (e) { console.warn('launch', e); }
  if (!ok) {
    notify({ title: `Couldn’t open ${app.name}`, body: 'Check it’s still on this tablet, then try again.' });
    return false;
  }
  androidOpen.set(app.id, app);
  markOpen(`a:${app.id}`);
  renderRail();
  return true;
}

/** Close one open app (the switcher, or Settings → System monitor): out of the rail, and reset through its onClose. Home and Claude stay. */
export function closeApp(key: string): void {
  if (UNCLOSABLE.has(key)) return;
  opened = opened.filter(k => k !== key);
  if (key.startsWith('a:')) androidOpen.delete(key.slice(2));
  else {
    const app = apps.find(a => a.id === key);
    if (app?.onClose && !failed.has(app.id)) guard(app, 'onClose', () => app.onClose!());
  }
  renderRail();
}

function switcherCards(): SwitcherCard[] {
  const keys = [...opened];
  for (const k of ['home', 'claude']) if (apps.some(a => a.id === k) && !keys.includes(k)) keys.push(k);
  return keys.flatMap((k): SwitcherCard[] => {
    if (k.startsWith('a:')) {
      const a = androidOpen.get(k.slice(2));
      return a ? [{ key: k, name: a.name, icon: androidIcon(a), closable: true }] : [];
    }
    const app = apps.find(a => a.id === k);
    if (!app) return [];
    const icon = ownBtns.get(k)?.querySelector('.ri-icon')?.innerHTML || app.icon;
    return [{ key: k, name: app.name, icon, section: document.getElementById(`app-${k}`) || undefined, closable: !UNCLOSABLE.has(k) }];
  });
}

/** Apps that threw while mounting: they keep their rail button, and their section says so. */
const failed = new Set<string>();
/** Each app's mount context, kept so that a failed app can be mounted again (restartApp). */
const mountCtx = new Map<string, AppContext>();

/** The open apps, most recent first: an app id or 'a:<package>' key, its name, and whether it can be closed. */
export function openedApps(): { key: string; name: string; closable: boolean }[] {
  return opened.flatMap(k => {
    if (k.startsWith('a:')) { const a = androidOpen.get(k.slice(2)); return a ? [{ key: k, name: a.name, closable: true }] : []; }
    const app = apps.find(x => x.id === k);
    return app ? [{ key: k, name: app.name, closable: !UNCLOSABLE.has(k) }] : [];
  });
}

/** The apps that did not start, by id and name. */
export function failedApps(): { id: string; name: string }[] {
  return apps.filter(a => failed.has(a.id)).map(a => ({ id: a.id, name: a.name }));
}

/** Mount a failed app again and drop its note. It shows the note again if it throws once more. */
export function restartApp(id: string): boolean {
  const app = apps.find(a => a.id === id), cx = mountCtx.get(id);
  if (!app || !cx || !failed.has(id)) return false;
  failed.delete(id);
  cx.root.querySelector('.app-failed')?.remove();
  if (guard(app, 'mount', () => app.mount(cx))) return true;
  showFailed(app, cx.root);
  return false;
}

function logError(app: HubApp, where: string, e: unknown): void {
  const err = e as Error;
  console.error(`${app.id}.${where}`, e);
  try {
    void fetch('/api/core/log', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'app', msg: `${app.id}.${where}: ${String(err?.stack || err?.message || e)}`.slice(0, 500), ua: navigator.userAgent }) });
  } catch { /* nothing else to try */ }
}

/** Run one app's hook so that a throw stays inside that app. */
function guard(app: HubApp, where: string, fn: () => void): boolean {
  try { fn(); return true; } catch (e) { logError(app, where, e); return false; }
}

function showFailed(app: HubApp, root: HTMLElement): void {
  failed.add(app.id);
  const note = document.createElement('div');
  note.className = 'app-failed';
  note.innerHTML = `<b>${esc(app.name)} couldn’t start</b><span>The rest of ClaudeOS still works. It tries again when the page next updates.</span>`;
  root.appendChild(note);
}

function contextFor(app: HubApp, root: HTMLElement, header: AppHeader, rail: HTMLElement): AppContext {
  return {
    root,
    header,
    $<T extends Element = HTMLElement>(id: string): T {
      const el = root.querySelector(`#${CSS.escape(id)}`);
      if (!el) throw new Error(`${app.id}: missing #${id}`);
      return el as unknown as T;
    },
    setBadge: on => rail.classList.toggle('has-badge', on),
    setRail: ({ icon, label, busy }) => {
      if (icon != null) rail.querySelector('.ri-icon')!.innerHTML = icon;
      if (label != null) rail.querySelector('.ri-label')!.textContent = label;
      if (busy != null) rail.classList.toggle('busy', busy);
    },
    requestAttention: () => { wake(); closeControlCenter(); showApp(app.id); },
    isVisible: () => current === app.id,
    notify: n => notify({ ...n, app: app.id }, current === app.id && !document.hidden),
  };
}

/** Reload open pages when the server says the page's files have changed. */
function watchVersion(): void {
  let seen: number | null = null;
  const check = async (): Promise<void> => {
    try {
      const { version } = await getJson<{ version: number }>('/api/core/version');
      reportHubCheck(true);
      if (seen === null) seen = version;
      else if (version !== seen) location.reload();
    } catch { reportHubCheck(false); /* server restarting; try again */ }
    // every 10 seconds on screen; once a minute with the page hidden or in low power
    setTimeout(check, document.hidden || document.documentElement.classList.contains('low-power') ? 60e3 : 10e3);
  };
  void check();
}

/** Claude Home's own apps, in rail order (the Apps screen lists them). */
export function installedApps(): { id: string; name: string; icon: string }[] {
  const hidden = focusHidden();
  return apps.filter(a => !hidden.includes(a.id) || fixedIds().includes(a.id)).map(a => ({ id: a.id, name: a.name, icon: a.icon }));
}

export async function startHub(list: HubApp[]): Promise<void> {
  apps = list;
  fitStage();
  initKeyboard();
  initMotion();

  const nav = $('rail'), stage = $('stage');
  const foot = nav.querySelector('.rail-foot')!;
  pins = loadPins();
  railApps = document.createElement('div');
  railApps.className = 'rail-apps';
  nav.insertBefore(railApps, foot);
  pill = document.createElement('i');
  pill.className = 'rail-pill'; pill.setAttribute('aria-hidden', 'true');
  railApps.prepend(pill);
  nav.classList.add('has-pill');
  initRailReorder();
  // load every app's view and styles first, then mount them in order
  const views = await Promise.all(apps.map(a => fetch(`/src/apps/${a.id}/view.html`, { cache: 'no-cache' }).then(r => r.text())));
  const headers = new Map<string, AppHeader>();
  apps.forEach((app, i) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = `/src/apps/${app.id}/app.css`;
    document.head.appendChild(css);

    const root = document.createElement('section');
    root.className = 'app'; root.id = `app-${app.id}`;
    root.innerHTML = views[i];
    headers.set(app.id, renderAppHeader(root, app));   // the same icon + name, in the same place, on every page
    addStatus(headers.get(app.id)!.el, app.id);        // and the same status cluster on the right (status.ts)
    stage.insertBefore(root, $('kb'));

    const btn = document.createElement('button');
    btn.className = 'ri'; btn.dataset.app = app.id;
    btn.innerHTML = `<span class="ri-icon">${app.icon}</span><span class="ri-label">${esc(app.name)}</span><i class="badge"></i>`;
    btn.addEventListener('click', () => { showApp(app.id); report(`app:${app.id}`); });
    btn.hidden = true;   // renderRail() shows the ones that belong in the rail
    railApps!.appendChild(btn);
    ownBtns.set(app.id, btn);
  });
  renderSparks();
  initTheme();
  initSystem(stage, {
    openApp: id => { if (apps.some(a => a.id === id)) showApp(id); },
    // the rail's copy, as drawn (the Claude spark is filled in at runtime)
    appIcon: id => nav.querySelector(`.ri[data-app="${id}"] .ri-icon`)?.innerHTML || apps.find(a => a.id === id)?.icon || '',
  });
  initStatus();
  apps.forEach(app => {
    const root = $(`app-${app.id}`);
    const cx = contextFor(app, root, headers.get(app.id)!, nav.querySelector<HTMLElement>(`.ri[data-app="${app.id}"]`)!);
    mountCtx.set(app.id, cx);
    if (!guard(app, 'mount', () => app.mount(cx))) showFailed(app, root);
  });

  initSwitcher(stage, {
    cards: switcherCards,
    current: () => current || apps[0].id,
    open: key => {
      if (key.startsWith('a:')) { const a = androidOpen.get(key.slice(2)); if (a) launchAndroid(a); }
      else showApp(key);
    },
    close: closeApp,
  });
  // back from an Android app: the Claude Home app on screen is the most recent again
  onResume(() => { if (current) { markOpen(current); renderRail(); } });
  // a focus mode changed which apps show (focus-modes.ts): the rail is drawn again
  addEventListener('hub:store', (e: Event) => { if ((e as CustomEvent).detail === 'os.focusApps') renderRail(); });

  document.addEventListener('pointerdown', () => { lastTouch = Date.now(); }, true);
  document.addEventListener('touchstart', () => report('touch'), { passive: true, once: true });
  setInterval(() => {   // drift back to the first app when nobody has touched the screen for a while
    if (current !== apps[0].id && Date.now() - lastTouch > IDLE_HOME_MS) showApp(apps[0].id);
  }, 30e3);
  watchVersion();

  (window as any).hubBooted?.();   // started fine: hide the start screen and stop the watchdogs in index.html
  const want = params.get('app') || store.get('app') || apps[0].id;
  showApp(apps.some(a => a.id === want) ? want : apps[0].id);
}
