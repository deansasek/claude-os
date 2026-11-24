// ClaudeOS app icons, drawn with the Weather icon's pen (src/apps/weather/web/art.ts is the reference):
// a loose, hand-drawn ink line on the 32 grid, 1.8 wide, round ends and joins, in the text colour.
// Every app's rail, Apps-grid and header icon comes from here, so one pen draws them all.
//
//   appIcon('photos')      → the icon's SVG markup (the same every time: the jitter is seeded by the name)
//   clockIcon(new Date())  → the Clock icon, with its hands at that time
//
// A new icon is one entry in DRAW: build it from line(), poly() and ring(), on the 32 grid, inside 4..28.
// The rules it must follow are in ICON_RULES; `npm run check:icons` checks every icon against them.
import { loop, rng } from './ink.ts';

type P = [number, number];
type Rand = () => number;

/** The style rules, taken from the Weather icon. scripts/check-icons.ts enforces the ones a machine can check. */
export const ICON_RULES = [
  'Grid: viewBox 0 0 32 32; keep the drawing inside 4..28 (a 4-unit margin).',
  'Pen: one stroke width, 1.8 (2 only on the clay spot variant); never scale the width with the art.',
  'Ends and joins: stroke-linecap and stroke-linejoin are always round.',
  'Line, not fill: fill="none" on every stroke; fills only for small dots (radius 1.2 or less) or an occluding cloud.',
  'Hand-drawn: lines go through points with a little seeded jitter (0.25 to 0.35), never ruler-straight paths.',
  'Open loops: circles and closed shapes are one stroke that runs a little past its start.',
  'Soft corners: corners are rounded by the pen (radius 0.8 to 4.5), never sharp mitres.',
  'Ink: currentColor (the --t1/--t2 text colour from the context); at most one accent, var(--clay) warm or var(--blue) wet.',
  'No raster: no <image>, emoji, text glyphs or Android icons; vector paths only.',
  'Optical size: the main shape spans about 20 to 22 units, so icons look equal next to each other in the rail.',
] as const;

export const ICON_VIEWBOX = '0 0 32 32';
export const ICON_PEN = 1.8;
const PEN = `fill="none" stroke="currentColor" stroke-width="${ICON_PEN}" stroke-linecap="round" stroke-linejoin="round"`;
const f = (n: number) => n.toFixed(2);

/** A smooth hand-drawn line through points, with a little jitter (the Weather icon's `hand`). */
function hand(pts: P[], rnd: Rand, j = .3): string {
  const q = pts.map(([x, y]) => [x + (rnd() * 2 - 1) * j, y + (rnd() * 2 - 1) * j] as P);
  let d = `M${f(q[0][0])} ${f(q[0][1])}`;
  for (let i = 0; i < q.length - 1; i++) {
    const p0 = q[Math.max(0, i - 1)], p1 = q[i], p2 = q[i + 1], p3 = q[Math.min(q.length - 1, i + 2)];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const unit = (a: P, b: P): P => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };

/** Points that round the corner at `v` (coming from `a`, going to `b`) with radius r. */
function corner(a: P, v: P, b: P, r: number): P[] {
  const i = unit(a, v), o = unit(v, b), k = .29;
  return [[v[0] - i[0] * r, v[1] - i[1] * r], [v[0] - i[0] * r * k + o[0] * r * k, v[1] - i[1] * r * k + o[1] * r * k], [v[0] + o[0] * r, v[1] + o[1] * r]];
}

interface Pen { rnd: Rand }
/** A straight stroke from a to b, with a midpoint so the hand can wobble. */
function line(p: Pen, a: P, b: P): string {
  return `<path d="${hand([a, lerp(a, b, .5), b], p.rnd)}"/>`;
}
/**
 * A polyline through `pts` with each inner corner rounded by r (a number, or one per point).
 * `closed` draws the shape in one stroke that starts mid-edge and runs a little past where it started.
 */
function poly(p: Pen, pts: P[], r: number | number[] = 1, closed = false): string {
  const n = pts.length, rad = (i: number) => (Array.isArray(r) ? r[(i + n) % n] : r);
  const at = (i: number) => pts[(i + n) % n];
  const out: P[] = [];
  if (closed) {
    const start = lerp(pts[0], pts[1], .5);
    out.push(start);
    for (let i = 1; i <= n; i++) out.push(...corner(at(i - 1), at(i), at(i + 1), rad(i)));
    out.push(start, lerp(start, pts[1], .3));   // the overshoot
  } else {
    out.push(pts[0]);
    for (let i = 1; i < n - 1; i++) out.push(...corner(pts[i - 1], pts[i], pts[i + 1], rad(i)));
    out.push(pts[n - 1]);
  }
  return `<path d="${hand(out, p.rnd)}"/>`;
}
/** A rounded rectangle in one stroke. */
const box = (p: Pen, x: number, y: number, w: number, h: number, r: number) =>
  poly(p, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], r, true);
/** A circle in one stroke that runs a little past its start (the Weather sun). */
function ring(p: Pen, cx: number, cy: number, r: number): string {
  return `<path d="${loop(cx, cy, r, r, p.rnd, .04)}"/>`;
}
/** A curve through points (an arc, a meridian). */
const curve = (p: Pen, pts: P[]) => `<path d="${hand(pts, p.rnd)}"/>`;
/** Points along a circular arc, from angle a0 to a1 (degrees, 0 = right, 90 = down). */
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, steps = 6): P[] =>
  Array.from({ length: steps + 1 }, (_, i) => { const t = (a0 + (a1 - a0) * i / steps) * Math.PI / 180; return [cx + r * Math.cos(t), cy + r * Math.sin(t)] as P; });

const house = (p: Pen) =>
  poly(p, [[5.5, 14.5], [16, 6], [26.5, 14.5]], 1.2)
  + poly(p, [[8.5, 12.5], [8.5, 25.5], [23.5, 25.5], [23.5, 12.5]], 1.6)
  + poly(p, [[13.5, 25.5], [13.5, 19], [18.5, 19], [18.5, 25.5]], .8);

const DRAW = {
  home: house,
  // Home Assistant: the same house, a touch wider (as before this pen)
  'home-assistant': (p: Pen) =>
    poly(p, [[5, 15], [16, 6], [27, 15]], 1.2)
    + poly(p, [[8, 13], [8, 26], [24, 26], [24, 13]], 1.6)
    + poly(p, [[13.5, 26], [13.5, 19.5], [18.5, 19.5], [18.5, 26]], .8),
  apps: (p: Pen) => box(p, 6, 6, 8, 8, 2.2) + box(p, 18, 6, 8, 8, 2.2) + box(p, 6, 18, 8, 8, 2.2) + box(p, 18, 18, 8, 8, 2.2),
  browser: (p: Pen) =>
    ring(p, 16, 16, 11) + line(p, [5.2, 16], [26.8, 16])
    + curve(p, [[16, 5], [12.2, 9.5], [11, 16], [12.2, 22.5], [16, 27]])
    + curve(p, [[16, 5], [19.8, 9.5], [21, 16], [19.8, 22.5], [16, 27]]),
  calendar: (p: Pen) =>
    box(p, 5.5, 7.5, 21, 19, 3) + line(p, [5.5, 13.5], [26.5, 13.5])
    + line(p, [11, 5], [11, 10]) + line(p, [21, 5], [21, 10])
    + line(p, [10.5, 18], [13.5, 18]) + line(p, [18.5, 18], [21.5, 18]) + line(p, [10.5, 22], [13.5, 22]),
  camera: (p: Pen) =>
    poly(p, [[5, 9.5], [10.2, 9.5], [12.2, 6.5], [19.8, 6.5], [21.8, 9.5], [27, 9.5], [27, 25.5], [5, 25.5]], [2, .8, .8, .8, .8, 2, 2, 2], true)
    + ring(p, 16, 17, 4.6),
  lists: (p: Pen) =>
    poly(p, [[5, 9], [7, 11], [10.5, 7.5]], .6) + poly(p, [[5, 17], [7, 19], [10.5, 15.5]], .6) + poly(p, [[5, 25], [7, 27], [10.5, 23.5]], .6)
    + line(p, [14.5, 9.5], [27, 9.5]) + line(p, [14.5, 17.5], [27, 17.5]) + line(p, [14.5, 25.5], [23, 25.5]),
  // News: a folded paper, a headline bar over two columns of lines
  news: (p: Pen) =>
    box(p, 5, 7, 22, 18, 2.6) + line(p, [9, 11.5], [23, 11.5])
    + line(p, [9, 16], [15, 16]) + line(p, [9, 20], [15, 20]) + line(p, [9, 23.5], [15, 23.5])
    + line(p, [18, 16], [23, 16]) + line(p, [18, 20], [23, 20]),
  photos: (p: Pen) =>
    box(p, 5, 7, 22, 18, 3) + poly(p, [[5.5, 21], [11, 15.5], [16, 20], [19, 17], [26.5, 24.5]], 1) + ring(p, 20.5, 12.5, 1.8),
  routines: (p: Pen) =>
    line(p, [6, 9.5], [9, 9.5]) + line(p, [6, 16], [9, 16]) + line(p, [6, 22.5], [9, 22.5])
    + line(p, [13, 9.5], [26, 9.5]) + line(p, [13, 16], [26, 16]) + line(p, [13, 22.5], [21, 22.5])
    + poly(p, [[24.5, 20], [27.5, 22.5], [24.5, 25]], .6),
  recipes: (p: Pen) =>
    box(p, 6, 14, 17, 10, 3) + line(p, [23, 16], [27, 13]) + line(p, [5, 12], [24, 12]) + line(p, [11, 9], [17, 9]),
  radio: (p: Pen) =>
    box(p, 5, 11, 22, 16, 3) + line(p, [11, 11], [20, 4]) + ring(p, 20, 19, 2.8)
    + line(p, [8, 16], [15, 16]) + line(p, [8, 20.5], [14, 20.5]),
  settings: (p: Pen) =>
    line(p, [6, 10], [17, 10]) + line(p, [23, 10], [26, 10]) + line(p, [6, 22], [9, 22]) + line(p, [15, 22], [26, 22])
    + ring(p, 20, 10, 3) + ring(p, 12, 22, 3),
  voice: (p: Pen) =>
    box(p, 11.5, 4, 9, 15, 4.4) + curve(p, arc(16, 14.5, 8.5, 180, 0))
    + line(p, [16, 23], [16, 27.5]) + line(p, [12, 27.5], [20, 27.5]),
} satisfies Record<string, (p: Pen) => string>;

/** Every icon name, typed: a new icon is one entry in DRAW. */
export type AppIconName = keyof typeof DRAW;
export const APP_ICONS = Object.keys(DRAW) as AppIconName[];

const seed = (name: string) => [...name].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
// the pen sits on the <svg> itself (as the old icons had it), so a container's CSS can still restyle it
const wrap = (body: string) => `<svg viewBox="${ICON_VIEWBOX}" ${PEN} aria-hidden="true">${body}</svg>`;

const cache = new Map<AppIconName, string>();
/** The app icon's SVG markup. */
export function appIcon(name: AppIconName): string {
  let s = cache.get(name);
  if (!s) { s = wrap(DRAW[name]({ rnd: rng(seed(name)) })); cache.set(name, s); }
  return s;
}

/** The Clock app's icon: a hand-drawn face with its hands at time `d`. */
export function clockIcon(d: Date = new Date()): string {
  const p: Pen = { rnd: rng(seed('clock')) };
  const m = d.getMinutes(), h = ((d.getHours() % 12) + m / 60) * 30;
  const to = (deg: number, r: number): P => { const t = (deg - 90) * Math.PI / 180; return [16 + r * Math.cos(t), 16 + r * Math.sin(t)]; };
  return wrap(ring(p, 16, 16, 11.5) + line(p, [16, 16], to(h, 5.6)) + line(p, [16, 16], to(m * 6, 8.2)));
}
