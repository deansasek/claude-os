// Hand-drawn shapes in the style of Anthropic's illustrations: a flat clay blob with a
// loose black ink line on top, slightly off-register, never quite closing on itself.
import { esc, replay } from './dom.ts';

export const INK = '#141413';
type Pt = [number, number];
type Rand = () => number;

/** Small seeded random generator, so a shape can be drawn the same way twice. */
export function rng(seed: number): Rand {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => n.toFixed(2);

/** Smooth curve through points (Catmull-Rom → cubic Béziers). */
function smooth(pts: Pt[], closed: boolean): string {
  const n = pts.length, at = (i: number) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return closed ? d + 'Z' : d;
}

function blobPoints(cx: number, cy: number, rx: number, ry: number, rnd: Rand, lumps: number, wobble: number): Pt[] {
  const start = rnd() * Math.PI * 2;
  return Array.from({ length: lumps }, (_, i) => {
    const a = start + (i / lumps) * Math.PI * 2, k = 1 + (rnd() * 2 - 1) * wobble;
    return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k] as Pt;
  });
}

/** A lumpy closed blob, like a cut-paper shape. */
export function blob(cx: number, cy: number, rx: number, ry: number, rnd: Rand = Math.random, lumps = 9, wobble = .07): string {
  return smooth(blobPoints(cx, cy, rx, ry, rnd, lumps, wobble), true);
}

/** Point on the closed Catmull-Rom curve through pts, at s in [0, n). Same curve smooth() draws. */
function onCurve(pts: Pt[], s: number): Pt {
  const n = pts.length, i = Math.floor(s) % n, t = s - Math.floor(s);
  const [p0, p1, p2, p3] = [pts[(i - 1 + n) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]];
  const c = (a: number, b: number, d: number, e: number) =>
    .5 * (2 * b + (-a + d) * t + (2 * a - 5 * b + 4 * d - e) * t * t + (-a + 3 * b - 3 * d + e) * t * t * t);
  return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
}

/**
 * A filled shape plus an ink line that follows its edge exactly, the way a pen would:
 * it starts a touch inside the edge, ends a touch outside, and overlaps itself a little
 * where it closes. `offset` prints the line slightly off-register from the fill.
 */
export function inkedShape(pts: Pt[], centre: Pt, offset: Pt = [0, 0], drift = 1, over = .12): { fill: string; line: string } {
  const n = pts.length, per = 10, total = Math.round(n * per * (1 + over));
  const line: Pt[] = [];
  for (let k = 0; k <= total; k++) {
    const s = (k / per) % n, [x, y] = onCurve(pts, s);
    const dx = x - centre[0], dy = y - centre[1], len = Math.hypot(dx, dy) || 1;
    const d = -drift + 2 * drift * (k / total);                 // inside → outside over the stroke
    line.push([x + dx / len * d + offset[0], y + dy / len * d + offset[1]]);
  }
  return { fill: smooth(pts, true), line: smooth(line, false) };
}

/** A lumpy blob with a traced ink outline (see inkedShape). */
export function inkedBlob(cx: number, cy: number, rx: number, ry: number, rnd: Rand = Math.random, lumps = 9, wobble = .07,
                          offset: Pt = [0, 0], drift = Math.min(rx, ry) * .03): { fill: string; line: string } {
  return inkedShape(blobPoints(cx, cy, rx, ry, rnd, lumps, wobble), [cx, cy], offset, drift);
}

/** An ink outline drawn in one stroke that runs a little past where it started. */
export function loop(cx: number, cy: number, rx: number, ry: number, rnd: Rand = Math.random, wobble = .05): string {
  const start = rnd() * Math.PI * 2, steps = 12, over = .35 + rnd() * .25;
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = start + (i / steps) * (Math.PI * 2 + over), k = 1 + (rnd() * 2 - 1) * wobble;
    const drift = 1 - (i / steps) * .04;   // the end lands just inside the start
    pts.push([cx + Math.cos(a) * rx * k * drift, cy + Math.sin(a) * ry * k * drift]);
  }
  return smooth(pts, false);
}

/**
 * Show a hand-drawn speech bubble in `el` (an absolutely positioned .say element).
 * The shape is redrawn every time, so no two bubbles look quite alike.
 */
export function inkSay(el: HTMLElement, text: string, tail: 'left' | 'right' = 'right'): void {
  // lay the text out first, then draw the bubble at its real size (no stretching)
  el.innerHTML = `<span>${esc(text)}</span>`;
  const w = el.offsetWidth, h = el.offsetHeight;
  const rnd = rng(Math.floor(Math.random() * 1e9));
  const bodyH = h - 12, cx = w / 2, cy = bodyH / 2 + 1, rx = w / 2 - 3, ry = bodyH / 2;
  const dir = tail === 'right' ? 1 : -1;
  const tailAt = Math.PI / 2 - dir * .62;                       // where the tail leaves the body (lower right or left)

  // the body: a slightly lumpy oval, with the tail built into the same outline
  const pts: Pt[] = [];
  const lumps = 11, start = rnd() * Math.PI * 2;
  for (let i = 0; i < lumps; i++) {
    const a = start + (i / lumps) * Math.PI * 2;
    const da = Math.atan2(Math.sin(a - tailAt), Math.cos(a - tailAt));
    if (Math.abs(da) < .34) continue;                           // leave room for the tail
    const k = 1 + (rnd() * 2 - 1) * .035;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  const at = (a: number, k = .98): Pt => [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k];
  const tip: Pt = [cx + Math.cos(tailAt) * rx + dir * 12, h - 1];
  const tailPts: Pt[] = dir > 0 ? [at(tailAt - .2), tip, at(tailAt + .16)] : [at(tailAt - .16), tip, at(tailAt + .2)];
  // splice the tail in, in angular order
  const ang = (p: Pt) => Math.atan2((p[1] - cy) / ry, (p[0] - cx) / rx);
  const all = [...pts, ...tailPts].sort((p, q) => ((ang(p) - start + 8 * Math.PI) % (2 * Math.PI)) - ((ang(q) - start + 8 * Math.PI) % (2 * Math.PI)));
  const { fill, line } = inkedShape(all, [cx, cy], [1.2, 1], 1.4);

  el.insertAdjacentHTML('afterbegin', `<svg class="ink-bg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <path d="${fill}" fill="var(--bubble)"/>
      <path d="${line}" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`);
  replay(el, 'go');
}
