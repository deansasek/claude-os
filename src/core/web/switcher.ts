// The app switcher: every open app as a card in a horizontal row, over a dimmed, blurred backdrop.
//
// Open it by swiping up from the bottom edge of the stage, tapping the small handle bar at the bottom,
// or (on the tablet without device owner) swiping up on Guard.java's bottom strip, which calls
// window.hubSwitcher(). The current app shrinks into its card. Cards are the apps' real <section class="app">
// elements, scaled down with a transform (live, never cloned); Android apps are drawn as icon + name cards.
//   tap a card        it zooms back to full screen and opens
//   flick a card up   it closes (shell.ts: leaves the rail, HubApp.onClose resets it); Home and Claude stay
//   Close all         at the end of the row
//   Back, or tapping the backdrop, goes back to the app you were in.
// Only transform and opacity animate, on the motion tokens (core.css); with reduced motion, things only fade.
import { esc } from './dom.ts';
import { Keyboard } from './keyboard.ts';
import { motionMs, reducedMotion } from './motion.ts';
import { closeControlCenter, onBack, setSwitcherShade } from './system.ts';

export interface SwitcherCard {
  key: string;                 // an app id, or 'a:<package>' for an Android app
  name: string;
  icon: string;                // markup: an SVG, or an <img> for Android apps
  section?: HTMLElement;       // the app's own <section class="app"> (Claude Home apps)
  closable: boolean;
}
interface SwitcherHooks {
  cards(): SwitcherCard[];     // open apps, most recent first
  current(): string;
  open(key: string): void;     // show a Claude Home app, or launch an Android app
  close(key: string): void;    // close one app (shell.ts)
}

// geometry, in stage pixels (the stage is 1024 × 600). The app section's box is read from the layout
// (measureSection): the rail sets its edge, so the section starts after the rail on the left, or at 0 on the right or top.
const SW = 1024, SEC_W = 940, SEC_H = 600;
let box = { l: 84, t: 0, w: SEC_W, h: SEC_H };
const measureSection = (): void => {
  const a = stage.querySelector<HTMLElement>('.app');
  if (a) box = { l: a.offsetLeft, t: a.offsetTop, w: a.offsetWidth, h: a.offsetHeight };   // offset* ignores the card transforms
};
const S = .46;                                   // card scale
const CW = SEC_W * S, CH = SEC_H * S;            // 432 × 276
const GAP = 34, PITCH = CW + GAP;
const CY = 322;                                  // card centre

let hooks: SwitcherHooks;
let stage: HTMLElement;
let shade: HTMLElement, top: HTMLElement, closeAllBtn: HTMLElement;
let open = false, busy = false;
let cards: SwitcherCard[] = [];
const els = new Map<string, { card: HTMLElement; label: HTMLElement }>();   // per key: the moving element + its label
let scrollX = 0;
const parked: HTMLElement[] = [];
// motion tokens, read once (reading them mid-animation would force a style pass)
const DUR = { slow: 380, base: 220 };

const scale = () => stage.getBoundingClientRect().width / stage.offsetWidth;
const toStage = (e: PointerEvent) => { const r = stage.getBoundingClientRect(), s = scale(); return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s }; };
const cx = (i: number) => SW / 2 + i * PITCH - scrollX;
const maxScroll = () => Math.max(0, (cards.length - 1) * PITCH + CW / 2 + GAP + 76 - SW / 2 + 40);
const cardTf = (i: number, dy = 0, dx = 0) => `translate3d(${(cx(i) + dx - (box.l + box.w / 2)).toFixed(1)}px, ${(CY - box.h / 2 + dy - box.t).toFixed(1)}px, 0) scale(${S})`;
const labelTf = (i: number, dy = 0) => `translate3d(${(cx(i) - CW / 2).toFixed(1)}px, ${(CY - CH / 2 - 40 + dy).toFixed(1)}px, 0)`;
const closeAllTf = () => `translate3d(${(cx(cards.length - 1) + CW / 2 + GAP).toFixed(1)}px, ${CY - 38}px, 0)`;

function trans(kind: 'move' | 'fast' | 'none'): string {
  if (kind === 'none') return 'none';
  const fade = `opacity var(--dur-base) var(--ease-out)`;
  if (reducedMotion()) return fade;
  return kind === 'move' ? `transform var(--dur-slow) var(--ease-emph), ${fade}` : `transform var(--dur-base) var(--ease-out), ${fade}`;
}
function setEl(el: HTMLElement, tf: string, op: number, t: string): void {
  el.style.transition = t;
  el.style.transform = tf;
  el.style.opacity = String(op);
}
/** Lay every card out where it belongs (scroll position), with the given transition. */
function layout(t: 'move' | 'fast' | 'none', skip?: string): void {
  cards.forEach((c, i) => {
    const e = els.get(c.key);
    if (!e || c.key === skip) return;
    setEl(e.card, cardTf(i), 1, t);
    setEl(e.label, labelTf(i), 1, t);
  });
  setEl(closeAllBtn, closeAllTf(), cards.some(c => c.closable) ? 1 : 0, t);
  closeAllBtn.style.pointerEvents = cards.some(c => c.closable) ? '' : 'none';
}

function build(): void {
  shade = document.createElement('div');
  shade.className = 'sw-shade';
  top = document.createElement('div');
  top.className = 'sw-top';
  top.innerHTML = '<button class="sw-all" id="swAll" data-press="off"><span class="sw-all-x">×</span><span>Close all</span></button>';
  stage.append(shade, top);
  closeAllBtn = top.querySelector('#swAll')!;

  const handle = document.createElement('div');
  handle.className = 'sw-handle'; handle.setAttribute('role', 'button'); handle.setAttribute('aria-label', 'Open apps');
  handle.dataset.press = 'off';
  stage.appendChild(handle);
  handle.addEventListener('click', () => openSwitcher());
}

function makeCards(): void {
  top.querySelectorAll('.sw-label, .sw-acard').forEach(n => n.remove());
  els.clear();
  for (const c of cards) {
    const label = document.createElement('div');
    label.className = 'sw-label';
    label.innerHTML = `<span class="sw-ic">${c.icon}</span><span class="sw-name">${esc(c.name)}</span>`;
    top.appendChild(label);
    let card = c.section;
    if (!card) {
      card = document.createElement('div');
      card.className = 'sw-acard';
      card.innerHTML = `<span class="sw-acard-ic">${c.icon}</span><span class="sw-acard-name">${esc(c.name)}</span>`;
      top.insertBefore(card, top.firstChild);
    } else card.classList.add('sw-card');
    els.set(c.key, { card, label });
  }
}

/** Mirror the backdrop to the tablet's top strip (sendTop) as the animation starts, so the band changes in step. */
function shadeTop(on: boolean): void { setSwitcherShade(on); }

function openSwitcher(): void {
  if (open || busy || !hooks) return;
  if (stage.classList.contains('amb-on')) return;
  measureSection();
  if (Keyboard.isOpen) Keyboard.close('nav');
  closeControlCenter();
  cards = hooks.cards();
  if (!cards.length) return;
  open = true; busy = true;
  shadeTop(true);   // first, while styles are clean (it reads computed colours)
  const cur = hooks.current();
  scrollX = 0;
  makeCards();
  stage.classList.add('sw-on');

  // start: the current app full size where it is; the others waiting a little to the right, faded out
  cards.forEach((c, i) => {
    const e = els.get(c.key)!;
    e.card.style.visibility = 'visible';
    if (c.key === cur && c.section) setEl(e.card, 'none', 1, 'none');
    else setEl(e.card, cardTf(i, 0, reducedMotion() ? 0 : 60), 0, 'none');
    setEl(e.label, labelTf(i, 10), 0, 'none');
  });
  setEl(closeAllBtn, closeAllTf(), 0, 'none');
  void stage.offsetWidth;
  shade.classList.add('on'); top.classList.add('on');
  layout('move');
  setTimeout(() => { busy = false; }, DUR.slow);
}

/** Leave the switcher for one app: it zooms back to full screen, everything else fades away. */
function finish(key: string): void {
  if (!open) return;
  busy = true;
  shadeTop(false);   // first, while styles are clean
  const c = cards.find(x => x.key === key);
  const android = !c?.section;
  if (!android) hooks.open(key);   // the shell switches .on, the rail pill and onShow/onHide now
  cards.forEach(x => {
    const e = els.get(x.key)!;
    if (x.key === key && !android) setEl(e.card, 'none', 1, trans('move'));
    else setEl(e.card, e.card.style.transform, 0, trans('fast'));
    setEl(e.label, e.label.style.transform, 0, trans('fast'));
  });
  setEl(closeAllBtn, closeAllBtn.style.transform, 0, trans('fast'));
  shade.classList.remove('on'); top.classList.remove('on');
  if (android) {
    // back to the app you were in underneath, then hand over to Android
    const cur = cards.find(x => x.key === hooks.current());
    if (cur) setEl(els.get(cur.key)!.card, 'none', 1, trans('fast'));
    hooks.open(key);
  }
  setTimeout(cleanup, DUR.slow + 30);
}

function cleanup(): void {
  // all writes, one reflow, then hand the transitions back (a reflow per card cost ~50 ms on the tablet)
  const secs = [...els.values()].map(e => e.card).filter(el => el.classList.contains('sw-card'));
  secs.forEach(el => {
    el.style.transition = 'none';
    el.style.transform = ''; el.style.opacity = ''; el.style.visibility = '';
    el.classList.remove('sw-card');
  });
  if (secs.length) void stage.offsetWidth;
  secs.forEach(el => { el.style.transition = ''; });
  parked.forEach(el => { el.style.visibility = ''; });
  parked.length = 0;
  top.querySelectorAll('.sw-label, .sw-acard').forEach(n => n.remove());
  els.clear();
  stage.classList.remove('sw-on');
  open = false; busy = false;
}

/** Back, or a tap on the backdrop: return to the current app (or the most recent one still open). */
function dismissSwitcher(): void {
  if (!open || busy) return;
  const cur = hooks.current();
  const own = cards.filter(c => c.section);
  finish(own.some(c => c.key === cur) ? cur : own[0]?.key ?? cur);
}

function closeCard(key: string, dir = -1): void {
  const i = cards.findIndex(c => c.key === key);
  if (i < 0 || !cards[i].closable) return;
  const e = els.get(key)!;
  setEl(e.card, cardTf(i, dir * 560), 0, trans('fast'));
  setEl(e.label, labelTf(i, dir * 560), 0, trans('fast'));
  cards.splice(i, 1);
  hooks.close(key);
  const t = DUR.base;
  setTimeout(() => {
    if (e.card.classList.contains('sw-card')) {   // a real section: put it back to normal, hidden as it was
      e.card.style.transition = 'none'; e.card.style.transform = ''; e.card.style.opacity = ''; e.card.style.visibility = '';
      e.card.classList.remove('sw-card');
      void e.card.offsetWidth;
      e.card.style.transition = '';
      // the app you were in: still .on until you leave the switcher, so keep it out of sight till then
      if (e.card.classList.contains('on')) { e.card.style.visibility = 'hidden'; parked.push(e.card); }
    } else e.card.remove();
    e.label.remove();
    els.delete(key);
  }, t + 20);
  scrollX = Math.min(scrollX, maxScroll());
  layout('move', key);
}

function closeAll(): void {
  const closable = cards.filter(c => c.closable);
  if (!closable.length) return;
  busy = true;
  closable.forEach((c, n) => setTimeout(() => { busy = false; closeCard(c.key); busy = true; }, reducedMotion() ? 0 : n * 40));
  const after = (reducedMotion() ? 0 : closable.length * 40) + DUR.base + 40;
  setTimeout(() => { busy = false; finish(cards.some(c => c.key === 'home') ? 'home' : cards[0].key); }, after);
}

// ---------- gestures inside the switcher ----------
interface Drag { id: number; x0: number; y0: number; t0: number; mode: 'none' | 'scroll' | 'card' | 'down'; key?: string; sx0: number; lastX: number; lastT: number; vx: number; vy: number; lastY: number; dy: number }
let drag: Drag | null = null;

function hitCard(x: number, y: number): string | null {
  for (let i = 0; i < cards.length; i++) {
    if (Math.abs(x - cx(i)) <= CW / 2 && y >= CY - CH / 2 - 46 && y <= CY + CH / 2) return cards[i].key;
  }
  return null;
}

function bindGestures(): void {
  top.addEventListener('pointerdown', e => {
    if (!open || busy || (e.target as HTMLElement).closest('.sw-all')) return;
    const p = toStage(e);
    drag = { id: e.pointerId, x0: p.x, y0: p.y, t0: e.timeStamp, mode: 'none', key: hitCard(p.x, p.y) ?? undefined, sx0: scrollX, lastX: p.x, lastY: p.y, lastT: e.timeStamp, vx: 0, vy: 0, dy: 0 };
    try { top.setPointerCapture(e.pointerId); } catch { /* fine */ }
  });
  top.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = toStage(e), dx = p.x - drag.x0, dy = p.y - drag.y0;
    const dt = Math.max(1, e.timeStamp - drag.lastT);
    drag.vx = .7 * drag.vx + .3 * ((p.x - drag.lastX) / dt);
    drag.vy = .7 * drag.vy + .3 * ((p.y - drag.lastY) / dt);
    drag.lastX = p.x; drag.lastY = p.y; drag.lastT = e.timeStamp;
    if (drag.mode === 'none') {
      if (Math.hypot(dx, dy) < 10) return;
      const vertical = Math.abs(dy) > Math.abs(dx);
      // a swipe down closes the switcher (back to the app you were in); a swipe up on a card lifts it, as before
      drag.mode = vertical && dy > 0 ? 'down' : vertical && drag.key && cards.find(c => c.key === drag!.key)?.closable ? 'card' : 'scroll';
    }
    if (drag.mode === 'down') {
      drag.dy = dy;
    } else if (drag.mode === 'scroll') {
      let s = drag.sx0 - dx;
      const max = maxScroll();
      if (s < 0) s = s / 3; else if (s > max) s = max + (s - max) / 3;   // a little give past the ends
      scrollX = s;
      layout('none');
    } else if (drag.mode === 'card' && drag.key) {
      const i = cards.findIndex(c => c.key === drag!.key);
      const e2 = els.get(drag.key)!;
      drag.dy = dy < 0 ? dy : dy / 4;
      setEl(e2.card, cardTf(i, drag.dy), Math.max(.35, 1 + drag.dy / 700), 'none');
      setEl(e2.label, labelTf(i, drag.dy), Math.max(0, 1 + drag.dy / 200), 'none');
    }
  });
  const up = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (d.mode === 'none') {
      if (d.key) finish(d.key); else dismissSwitcher();
      return;
    }
    if (d.mode === 'down') {
      if (d.dy > 90 || (d.vy > .6 && d.dy > 24)) dismissSwitcher();
      return;
    }
    if (d.mode === 'scroll') {
      const fling = Math.max(-1.2, Math.min(1.2, d.vx)) * 260;     // a little momentum, then settle
      let target = scrollX - fling;
      target = Math.max(0, Math.min(maxScroll(), target));
      scrollX = target;
      layout('move');
      return;
    }
    if (d.key) {
      if (d.dy < -110 || (d.vy < -.6 && d.dy < -30)) closeCard(d.key);
      else layout('fast');
    }
  };
  top.addEventListener('pointerup', up);
  top.addEventListener('pointercancel', e => { if (drag?.mode === 'none' || drag?.mode === 'down') drag = null; else up(e); });
  closeAllBtn.addEventListener('click', closeAll);
}

// ---------- opening: a swipe up from the bottom edge ----------
// Android's own bottom gesture band (--grab-bottom, set from the tablet in system.ts sendTop) takes a swipe that
// starts in it: the page gets a pointercancel and MainActivity then calls window.hubSwipeUp(). A swipe from just above
// the band reaches the page and follows the finger like the pull-down (the current app and the backdrop move with
// it); on release it opens past 30% of the travel or on a flick, else it springs back. The grab zone is the bottom
// edge up to the band plus GRAB stage px. window.__swTrace keeps what the last swipes did (chrome://inspect).
const GRAB = 48;           // stage px above Android's band that still starts a swipe
const PULL = 240;          // stage px of travel for a full swipe
const FLICK = .5;          // px per ms
interface Swipe { id: number; x0: number; y0: number; y: number; t: number; dx: number; dy: number; vy: number; live: boolean }
let swipe: Swipe | null = null;
const swTrace: string[] = ((window as unknown as { __swTrace?: string[] }).__swTrace = []);
const note = (s: string): void => { swTrace.unshift(`${Math.round(performance.now())} ${s}`); swTrace.length = Math.min(swTrace.length, 40); };
const grabBottom = (): number => parseFloat(getComputedStyle(stage).getPropertyValue('--grab-bottom')) || 0;

/** The current app and the backdrop follow a swipe up (p: 0 at rest, 1 at a full swipe). */
function preview(dy: number): void {
  const p = Math.max(0, Math.min(1, dy / PULL));
  const app = stage.querySelector<HTMLElement>('.app.on');
  if (app) {
    app.style.transition = 'none';
    app.style.transform = `translate3d(0, ${(-Math.max(0, dy) * .35).toFixed(1)}px, 0) scale(${(1 - .04 * p).toFixed(3)})`;
  }
  shade.style.transition = 'none';
  shade.style.visibility = 'visible';
  shade.style.opacity = p.toFixed(3);
}

/** Let go of the preview: spring back to rest, or clear it at once when the switcher is about to open. */
function unpreview(spring: boolean): void {
  const app = stage.querySelector<HTMLElement>('.app.on');
  const t = spring && !reducedMotion() ? `transform ${DUR.base}ms var(--ease-out), opacity ${DUR.base}ms var(--ease-out)` : '';
  if (app) { app.style.transition = t; app.style.transform = ''; }
  shade.style.transition = t;
  shade.style.opacity = '';
  shade.style.visibility = '';
  if (spring) setTimeout(() => { if (!open) { if (app) app.style.transition = ''; shade.style.transition = ''; } }, DUR.base + 20);
}

/** True when the nearest scrolling pane under a touch can still scroll down: the touch is the page's, not the switcher's. */
function scrollsBelow(t: EventTarget | null): boolean {
  for (let n = t instanceof HTMLElement ? t : null; n && n !== stage; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n.scrollTop < n.scrollHeight - n.clientHeight - 1;
  }
  return false;
}

function bindEdge(): void {
  stage.addEventListener('pointerdown', e => {
    if (!e.isPrimary || open || busy || stage.classList.contains('amb-on') || document.querySelector('.cc.on')) return;
    measureSection();
    const p = toStage(e);
    if (p.x > box.l && p.x < box.l + box.w && p.y > stage.offsetHeight - grabBottom() - GRAB && !scrollsBelow(e.target)) {
      swipe = { id: e.pointerId, x0: p.x, y0: p.y, y: p.y, t: e.timeStamp, dx: 0, dy: 0, vy: 0, live: false };
    }
  }, true);
  stage.addEventListener('pointermove', e => {
    const s = swipe;
    if (!s || e.pointerId !== s.id) return;
    const p = toStage(e), dx = p.x - s.x0, dy = s.y0 - p.y;
    // velocity from windows of at least 10 ms: a burst of events in one frame is not a flick
    const dt = e.timeStamp - s.t;
    if (dt >= 10) { s.vy = s.vy * .4 + ((s.y - p.y) / dt) * .6; s.y = p.y; s.t = e.timeStamp; }
    s.dx = dx; s.dy = dy;
    if (!s.live) {
      if (dy < -8 || (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy))) { note('not a swipe up'); swipe = null; return; }
      if (dy < 8) return;   // not a swipe yet
      s.live = true;
      note(`live swipe up from y=${Math.round(s.y0)}`);
    }
    preview(dy);
  }, true);
  // a touch that is still a swipe up is held here, so Chromium doesn't start a scroll (and cancel the swipe) under it
  stage.addEventListener('touchmove', e => {
    const s = swipe;
    if (!s || !e.cancelable) return;
    if (s.live || (Math.abs(s.dx) <= Math.abs(s.dy) + 2 && s.dy >= 0)) e.preventDefault();
  }, { capture: true, passive: false });
  const end = (e: PointerEvent, cancelled: boolean) => {
    const s = swipe;
    if (!s || e.pointerId !== s.id) return;
    swipe = null;
    if (!s.live) return;
    const go = s.dy > PULL * .3 || (s.vy > FLICK && s.dy > 16);
    note(`${cancelled ? e.type : 'up'} dy=${Math.round(s.dy)} vy=${s.vy.toFixed(2)} ${go ? 'open' : 'back'}`);
    if (go) { unpreview(false); openSwitcher(); }
    else unpreview(true);
  };
  addEventListener('pointerup', e => end(e, false), true);
  // Android took the swipe (the MainActivity cancel): hubSwipeUp opens the switcher just after this. Opened here
  // already only if the finger got past the travel, so a short swipe that Android takes still ends up open.
  addEventListener('pointercancel', e => end(e, true), true);
}


export function initSwitcher(st: HTMLElement, h: SwitcherHooks): void {
  stage = st; hooks = h;
  DUR.slow = motionMs('--dur-slow') || 380; DUR.base = motionMs('--dur-base') || 220;
  build();
  bindGestures();
  bindEdge();
  onBack(() => { if (!open) return false; dismissSwitcher(); return true; }, 50);
  // the tablet app calls this from its bottom strip (Guard.java) when Android owns the bottom edge.
  // Open only: the strip also passes the touch on to the page, whose own edge swipe may get there first.
  (window as unknown as { hubSwitcher: () => void }).hubSwitcher = () => openSwitcher();
  // the tablet app calls this when Android takes a swipe up that started in its bottom band (MainActivity)
  (window as unknown as { hubSwipeUp: () => void }).hubSwipeUp = () => { note('hubSwipeUp: Android took the swipe'); openSwitcher(); };
}
