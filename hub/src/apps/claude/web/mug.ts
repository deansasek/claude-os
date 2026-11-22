// The coffee mug on the Claude screen: pick it up, shake it, lift it, drop it. The critter notices.
import type { AppContext } from '../../../core/web/shell.ts';
import { store } from '../../../core/web/dom.ts';
import { reducedMotion } from '../../../core/web/motion.ts';
import { react } from './critter.ts';

// Scene units. The mug rests with its base on the floor (y = 19), so its resting offset is (0, 0).
const X_RANGE: [number, number] = [-21, 4.3];   // keeps the mug inside x 1 to 29
const Y_RANGE: [number, number] = [-15, 0];     // 0 is the floor: it can be lifted, never pushed below
const HIGH_Y = -10;                             // mug base above y 9, over the critter's head
const MUG_X = 23.4, CRIT_X = 15;                // mug centre at rest, critter centre
const COOLDOWN = 2500;                          // at most one line every couple of seconds
const HOME_AFTER = 60000;                       // untouched this long away from home, the critter fetches it
const KEY = 'claude.mug.x';                     // where it was left (the floor's x offset)
const TAP_SLOP = .3;                            // scene units the pointer must move before it is a drag

type Kind = 'near' | 'far' | 'hot' | 'high';
type Act = 'hop' | 'wave' | 'look' | 'love' | 'dance' | 'walk';

const LINES: Record<Kind, string[]> = {
  near: ['ahh, coffee ♥', 'mmm, thanks ♥', 'my favourite!'],
  far: ['hey, my coffee!', "oi, that’s mine!", 'hey, come back!'],
  hot: ["careful, it’s hot!", 'whoa, careful!'],
  high: ['is it raining coffee?', 'coffee from above?'],
};

interface Drag {
  id: number;
  x0: number; y0: number;       // pointer at pickup, in scene units
  tx0: number; ty0: number;     // mug offset at pickup
  moved: boolean;               // past the tap threshold: this is a drag, not a tap
  spoke: boolean;               // already said a line this drag (one per drop)
  lastX: number;                // x of the last real sideways move, for shake detection
  dir: number;                  // -1, 0 or 1: last sideways direction
  flips: number[];              // times of recent direction changes
}

let svg: SVGSVGElement;
let mug: SVGGElement;
let tx = 0, ty = 0;
let glideFrame = 0;             // the settle / fetch-back animation
let dragFrame = 0;              // one position write per animation frame while dragging
let want: { x: number; y: number } | null = null;   // latest clamped drag target, scene units
let drag: Drag | null = null;
let suppressClick = false;
let lastSpoke = -Infinity;
let lastLine = '';
let homeTimer: number | undefined;

const clamp = (v: number, [lo, hi]: [number, number]): number => Math.min(hi, Math.max(lo, v));

/** Pointer position in scene units, whatever the stage scale (getScreenCTM includes the CSS transform and viewBox). */
function toScene(e: PointerEvent): { x: number; y: number } {
  const m = svg.getScreenCTM();
  if (!m) return { x: e.clientX, y: e.clientY };
  const p = svg.createSVGPoint();
  p.x = e.clientX; p.y = e.clientY;
  const q = p.matrixTransform(m.inverse());
  return { x: q.x, y: q.y };
}

function place(x: number, y: number): void {
  tx = clamp(x, X_RANGE);
  ty = clamp(y, Y_RANGE);
  mug.setAttribute('transform', `translate(${tx} ${ty})`);
}

/** Move the mug from where it is to (toX, toY) over ms, with an easing curve. */
function glide(toX: number, toY: number, ms: number, ease: (k: number) => number, done?: () => void): void {
  cancelAnimationFrame(glideFrame);
  const x0 = tx, y0 = ty, t0 = performance.now(), dur = Math.max(1, ms);
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / dur), e = ease(k);
    place(x0 + (toX - x0) * e, y0 + (toY - y0) * e);
    if (k < 1) glideFrame = requestAnimationFrame(step);
    else { glideFrame = 0; if (done) done(); }
  };
  if (dur <= 1) { glideFrame = 0; place(toX, toY); if (done) done(); return; }
  glideFrame = requestAnimationFrame(step);
}

const settle = (k: number): number => 1 - (1 - k) * (1 - k);                 // ease-out: a short, soft landing
const slide = (k: number): number => (k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

/** Say one line and act, unless a line was said a moment ago. Never the same line twice running. */
function speak(kind: Kind, act: Act, ms: number): boolean {
  const now = Date.now();
  if (now - lastSpoke < COOLDOWN) return false;
  lastSpoke = now;
  const pool = LINES[kind].filter(l => l !== lastLine);
  const line = pool[Math.floor(Math.random() * pool.length)];
  lastLine = line;
  react(act, ms, line);
  return true;
}

/** After a minute away from its spot, the critter fetches the mug back. */
function scheduleHome(): void {
  clearTimeout(homeTimer);
  homeTimer = Math.abs(tx) > .5 || Math.abs(ty) > .5 ? window.setTimeout(fetchHome, HOME_AFTER) : undefined;
}

function fetchHome(): void {
  homeTimer = undefined;
  if (drag) return;
  react('walk', 2400, 'back where it belongs');
  glide(0, 0, reducedMotion() ? 0 : 2000, slide, savePos);
}

function savePos(): void {
  store.set(KEY, Math.abs(tx) < .05 ? null : tx.toFixed(2));
}

function onDown(e: PointerEvent): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (drag) return;                          // a second finger: the first keeps the mug
  cancelAnimationFrame(glideFrame); glideFrame = 0;   // grabbing it mid-glide is fine
  clearTimeout(homeTimer); homeTimer = undefined;
  suppressClick = false;
  const p = toScene(e);
  want = null;
  drag = { id: e.pointerId, x0: p.x, y0: p.y, tx0: tx, ty0: ty, moved: false, spoke: false, lastX: p.x, dir: 0, flips: [] };
  try { mug.setPointerCapture(e.pointerId); } catch { /* no live pointer (synthetic event): the window listeners still track it */ }
}

/** Pointer moves are read on the window, so the drag survives a lost capture or a pointer that leaves the mug. */
function onMove(e: PointerEvent): void {
  const d = drag;
  if (!d || e.pointerId !== d.id) return;
  const p = toScene(e);
  if (!d.moved) {
    if (Math.hypot(p.x - d.x0, p.y - d.y0) < TAP_SLOP) return;   // still a tap
    d.moved = true;
    mug.classList.add('held');
    react('look', 1400);                                          // eyes follow the mug
  }
  want = { x: clamp(d.tx0 + p.x - d.x0, X_RANGE), y: clamp(d.ty0 + p.y - d.y0, Y_RANGE) };
  if (!dragFrame) dragFrame = requestAnimationFrame(paintDrag);

  // shaken: the sideways direction keeps flipping
  const dx = p.x - d.lastX;
  if (Math.abs(dx) > .4) {
    const dir = dx > 0 ? 1 : -1;
    if (d.dir && dir !== d.dir) d.flips.push(Date.now());
    d.dir = dir;
    d.lastX = p.x;
  }
  const now = Date.now();
  d.flips = d.flips.filter(t => now - t < 1000);
  if (!d.spoke && d.flips.length >= 4) d.spoke = speak('hot', 'wave', 1600);
  else if (!d.spoke && want.y <= HIGH_Y) d.spoke = speak('high', 'look', 2000);
}

function paintDrag(): void {
  dragFrame = 0;
  if (drag && want) place(want.x, want.y);
}

/** The drag ends: a release, a cancel (system gesture, long press) or a lost pointer. Never left hanging. */
function finish(id: number): void {
  const d = drag;
  if (!d || id !== d.id) return;
  drag = null;
  cancelAnimationFrame(dragFrame); dragFrame = 0;
  if (want) { place(want.x, want.y); want = null; }     // land on the last position the finger reached
  mug.classList.remove('held');
  try { if (mug.hasPointerCapture(id)) mug.releasePointerCapture(id); } catch { /* already released */ }
  if (!d.moved) return;                                  // a plain tap: the click goes on to the critter
  suppressClick = true;                                  // the click that follows this drag is not a tap; the next pointerdown clears it

  const cx = MUG_X + tx;
  const near = cx >= CRIT_X - 8 && cx <= CRIT_X + 10;
  const still = reducedMotion();
  glide(tx, 0, still ? 0 : Math.min(420, 160 + Math.abs(ty) * 26), settle, () => {
    if (!d.spoke && !still) {
      if (near) speak('near', 'love', 1600);
      else speak('far', 'hop', 800);
    }
    savePos();
    scheduleHome();
  });
}

export function initMug(ctx: AppContext): void {
  svg = ctx.$<SVGSVGElement>('scene');
  mug = ctx.$<SVGGElement>('mug');

  // restore where it was left (the floor, sideways)
  const saved = parseFloat(store.get(KEY) ?? '');
  if (Number.isFinite(saved)) { place(saved, 0); scheduleHome(); }

  mug.addEventListener('pointerdown', onDown);
  // moves and ends are read on the window: capture can be lost on Android, and the drag must still finish
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', e => finish(e.pointerId));
  addEventListener('pointercancel', e => finish(e.pointerId));
  // capture lost while the finger is still down: take it back. The window listeners carry the drag on either way.
  mug.addEventListener('lostpointercapture', e => {
    const d = drag;
    if (d && e.pointerId === d.id) { try { mug.setPointerCapture(d.id); } catch { /* the pointer is gone: pointerup or pointercancel ends it */ } }
  });
  // a long press on the mug is not a context menu, and a native drag is not a drag of the mug
  mug.addEventListener('contextmenu', e => e.preventDefault());
  mug.addEventListener('dragstart', e => e.preventDefault());
  // the end of a drag is not a tap on the critter (its click handler is on #centre, an ancestor of the scene):
  // stop the click on the way down, before it reaches the critter
  svg.addEventListener('click', e => {
    if (!suppressClick) return;
    e.stopPropagation(); e.preventDefault();
    suppressClick = false;
  }, true);
}
