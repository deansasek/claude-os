// Weather artwork: WMO codes, hand-drawn icons, and the critter dressed for the weather.
import type { Units } from '../api.ts';
import { blob, inkedBlob, loop, rng } from '../../../core/web/ink.ts';

export type Kind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';

export const WMO: Record<number, string> = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorms', 96: 'Thunderstorms, hail', 99: 'Thunderstorms, hail',
};

export function kindOf(c: number): Kind {
  if (c === 0) return 'clear';
  if (c <= 2) return 'partly';
  if (c === 3) return 'cloudy';
  if (c <= 48) return 'fog';
  if (c <= 57) return 'drizzle';
  if (c <= 67 || (c >= 80 && c <= 82)) return 'rain';
  if (c <= 77 || c === 85 || c === 86) return 'snow';
  return 'storm';
}

export const isCold = (t: number, u: Units) => u === 'celsius' ? t <= 3 : t <= 38;
const isHot =(t: number, u: Units) => u === 'celsius' ? t >= 29 : t >= 85;

// ---------- icons: loose, hand-drawn ink lines ----------
// With `blob`, a smaller clay shape sits off-register behind the drawing and the ink runs over
// its edge, the way Anthropic's spot illustrations are printed.
type P = [number, number];

/** A smooth hand-drawn line through points, with a little jitter. */
function hand(pts: P[], rnd: () => number, j = .35): string {
  const q = pts.map(([x, y]) => [x + (rnd() * 2 - 1) * j, y + (rnd() * 2 - 1) * j] as P);
  let d = `M${q[0][0].toFixed(2)} ${q[0][1].toFixed(2)}`;
  for (let i = 0; i < q.length - 1; i++) {
    const p0 = q[Math.max(0, i - 1)], p1 = q[i], p2 = q[i + 1], p3 = q[Math.min(q.length - 1, i + 2)];
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(2)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(2)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(2)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

/** A cloud outline in one stroke that overshoots where it started. */
function cloudLine(dy: number, rnd: () => number): string {
  const pts: P[] = [[10, 24], [16, 24.3], [22.5, 24], [26.5, 21.5], [25.5, 16.5], [21.5, 15], [19.5, 10.5], [14, 9.5], [10.5, 13.5],
    [6.5, 14.5], [4.8, 19.5], [7.5, 23.8], [12, 24.2]];
  return hand(pts.map(([x, y]) => [x, y + dy] as P), rnd, .3);
}

export function icon(code: number, day = true, opts: { blob?: boolean } = {}): string {
  const k = kindOf(code), onBlob = !!opts.blob;
  const rnd = rng(code * 31 + (day ? 7 : 3));
  // one pen for every icon: same weight, round ends; colour is passed separately so it can't be
  // shadowed by a duplicate attribute (the first `stroke=` on an element wins)
  const W = onBlob ? 2 : 1.8;
  const S = (color = 'currentColor', w = W, fill = 'none') =>
    `fill="${fill}" stroke="${color}" stroke-width="${w.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"`;
  // without a blob, sun, rain and lightning carry the colour; with one, the clay does and the ink stays ink
  const warm = onBlob ? 'currentColor' : 'var(--clay)', wet = onBlob ? 'currentColor' : 'var(--blue)';
  const sun = (cx: number, cy: number, r: number, ray: number) => {
    const rays = Array.from({ length: 8 }, (_, i) => {
      const t = (i * 45 + rnd() * 10) * Math.PI / 180, r1 = r + 2.2, r2 = r + 2.2 + ray * (.75 + rnd() * .5);
      return `M${(cx + r1 * Math.cos(t)).toFixed(1)} ${(cy + r1 * Math.sin(t)).toFixed(1)}L${(cx + r2 * Math.cos(t + .06)).toFixed(1)} ${(cy + r2 * Math.sin(t + .06)).toFixed(1)}`;
    }).join('');
    return `<g ${S(warm)}><path d="${loop(cx, cy, r, r, rnd, .07)}"/><path d="${rays}"/></g>`;
  };
  const moon = (dx = 0, dy = 0, s = 1) =>
    `<path transform="translate(${dx} ${dy}) scale(${s})" d="${hand([[19, 6], [11.5, 8.5], [8.5, 15.5], [11, 22.5], [17.5, 26], [23.5, 23.5], [26.2, 19.8], [20, 18.5], [16.5, 13], [17.5, 8.5], [19.5, 5.6]], rnd, .3)}" ${S('currentColor', W / s)}/>`;
  // the cloud is filled with the row's own background so a sun or moon can sit behind it
  const cloud = (dy = 0) => `<path d="${cloudLine(dy, rnd)}" ${S('currentColor', W, onBlob ? 'none' : 'var(--ic-bg, var(--bg))')}/>`;
  const strokes = (lines: P[][], color: string) => `<g ${S(color)}>${lines.map(l => `<path d="${hand(l, rnd, .25)}"/>`).join('')}</g>`;
  /** A six-armed flake drawn as three short strokes. */
  const flake = (x: number, y: number, s = 1.9): P[][] => [0, 60, 120].map(a => {
    const t = a * Math.PI / 180, dx = Math.cos(t) * s, dy = Math.sin(t) * s;
    return [[x - dx, y - dy], [x + dx, y + dy]] as P[];
  });
  let g: string;
  switch (k) {
    case 'clear': g = day ? sun(16, 16, 5, 3) : moon(); break;
    // the sun or moon peeks out from behind the cloud's right shoulder
    case 'partly': g = (day ? sun(20.5, 10.5, 3.7, 2) : moon(9, -2.5, .62)) + cloud(3); break;
    case 'cloudy': g = cloud(0); break;
    case 'fog': g = strokes([[[5, 11.5], [11, 10.5], [17, 12], [26, 11]], [[4, 16.5], [12, 15.5], [19, 17], [28, 16]], [[7, 21.5], [13, 20.5], [19, 22], [25, 21]]], 'currentColor'); break;
    case 'drizzle': g = cloud(-4) + `<g fill="${wet}"><circle cx="11" cy="25.5" r="1.2"/><circle cx="16.8" cy="27.8" r="1.2"/><circle cx="22" cy="25.3" r="1.2"/></g>`; break;
    case 'rain': g = cloud(-4) + strokes([[[10.8, 24.2], [9, 28.6]], [[16.4, 24.6], [14.6, 29]], [[22, 24.2], [20.2, 28.6]]], wet); break;
    case 'snow': g = cloud(-4) + strokes([...flake(10.5, 26.2), ...flake(21.8, 26.2), ...flake(16.2, 29.4, 1.7)], 'currentColor'); break;
    default: g = cloud(-4) + strokes([[[17.2, 20], [14, 25], [17.6, 25], [15.2, 30]]], warm);
  }
  // the clay sits low and to the right, smaller than the drawing, so the ink runs over its edge
  const back = onBlob ? `<path d="${blob(18.5, 18.5, 10.5, 9.5, rng(code + 99), 8, .1)}" fill="var(--clay)"/>` : '';
  return `<svg viewBox="0 0 32 32" class="ic${onBlob ? ' ic-spot' : ''}">${back}${g}</svg>`;
}

// ---------- the scene: same 30x22 stage and ground line as the Claude page ----------
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const LINE = 'var(--text)';

/** A hand-drawn cloud: flat-ish bottom, three soft bumps, a loose outline. */
function inkCloud(x: number, y: number, s: number, fill: string, delay = 0): string {
  const d = 'M.7 3.1C-.3 3.1-.2 1.6 1 1.7 1.1.6 2.6.2 3.3 1 3.8-.2 5.9-.1 6 1.3 7.3 1.2 7.7 3.1 6.6 3.1Z';
  return `<g class="w-drift" style="animation-delay:-${delay}s"><g transform="translate(${x} ${y}) scale(${s})">
      <path d="${d}" fill="${fill}" stroke="${LINE}" stroke-width="${(.13 / s).toFixed(3)}" stroke-linejoin="round" shape-rendering="auto"/></g></g>`;
}

interface SceneOpts {
  /** No forecast: the critter stands under an empty sky with a mark over its head ('?' or '…'). */
  mark?: string;
  windy?: boolean;
}

/** Wind strong enough for the critter to notice (gusty, not a breeze). */
export const isWindy = (speed: number, units: Units) => units === 'celsius' ? speed >= 35 : speed >= 22;

export function weatherScene(k: Kind, day: boolean, temp: number, units: Units, o: SceneOpts = {}): string {
  const empty = o.mark != null;
  const cold = isCold(temp, units), hot = isHot(temp, units);
  const wet = k === 'rain' || k === 'drizzle' || k === 'storm';
  const r = rng(Math.floor(Math.random() * 1e9));
  let back = '', front = '', acc = '';
  // sleepy at night when there's nothing else going on; eyes are drawn below
  const sleepy = !empty && !day && (k === 'clear' || k === 'partly' || k === 'cloudy');

  if (empty) {
    back += `<text class="w-mark" x="21.5" y="7" font-family="Source Serif 4, Georgia, serif" font-size="5" fill="var(--t3)" font-style="italic">${o.mark}</text>`;
  } else {
    if ((k === 'clear' || k === 'partly') && day) {
      const big = k === 'clear';
      const [cx, cy, rr] = big ? [24.5, 4, 2.1] : [23.8, 3.4, 1.7];
      const rays = Array.from({ length: 9 }, (_, i) => {
        const t = (i / 9) * Math.PI * 2, r1 = rr + .7, r2 = rr + 1.5 + r() * .4;
        return `M${(r1 * Math.cos(t)).toFixed(2)} ${(r1 * Math.sin(t)).toFixed(2)}L${(r2 * Math.cos(t)).toFixed(2)} ${(r2 * Math.sin(t)).toFixed(2)}`;
      }).join('');
      back += `<g transform="translate(${cx} ${cy})" shape-rendering="auto"><g class="w-spin"><path d="${rays}" stroke="${LINE}" stroke-width=".14" stroke-linecap="round"/></g>
        ${(({ fill, line }) => `<path d="${fill}" fill="var(--clay)"/><path d="${line}" fill="none" stroke="${LINE}" stroke-width=".14" stroke-linecap="round"/>`)(inkedBlob(0, 0, rr, rr, r, 8, .05, [.08, .06], .07))}</g>`;
    } else if ((k === 'clear' || k === 'partly') && !day) {
      back += `<path d="M24.6 1.4A2.6 2.6 0 1 0 26.3 6 2 2 0 1 1 24.6 1.4Z" fill="var(--cloud)" stroke="${LINE}" stroke-width=".13" stroke-linejoin="round" shape-rendering="auto"/>`;
      back += [[5, 3], [9, 1.4], [18.5, 2.2], [3, 7], [28, 8]].map(([x, y], i) =>
        `<path class="w-star" style="animation-delay:${i * .6}s" d="M${x} ${y - .35}v.7M${x - .35} ${y}h.7" stroke="var(--t3)" stroke-width=".12" stroke-linecap="round" shape-rendering="auto"/>`).join('');
    }
    if (k === 'partly') back += inkCloud(17.5, 3.4, 1, 'var(--cloud)', 4) + inkCloud(2, 1.6, .9, 'var(--cloud)', 9);
    if (k === 'cloudy') back += inkCloud(2, 2.2, 1.1, 'var(--cloud)', 3) + inkCloud(16, .8, 1.35, 'var(--cloud)', 8);
    if (wet || k === 'snow') {
      const f = k === 'storm' ? 'var(--storm)' : 'var(--cloud)';
      back += inkCloud(1, .6, 1.2, f, 2) + inkCloud(11, 0, 1.4, f, 7) + inkCloud(21, 1, 1.05, f, 11);
    }
    if (k === 'storm') back += `<path class="w-flash" d="M12.6 4.2L11.1 7H12.7L11.5 9.8" fill="none" stroke="var(--clay)" stroke-width=".5" stroke-linejoin="round" shape-rendering="auto"/>`;
    if (wet) {
      let d = '';
      const n = k === 'drizzle' ? 12 : 26;
      for (let i = 0; i < n; i++) {
        const dur = k === 'drizzle' ? rnd(1.3, 1.7) : rnd(.7, .95);
        d += `<rect class="w-drop" style="animation-delay:-${rnd(0, 1).toFixed(2)}s;animation-duration:${dur.toFixed(2)}s" x="${rnd(1, 30).toFixed(1)}" y="2" width=".16" height="${k === 'drizzle' ? .45 : .9}" fill="var(--blue)" opacity=".75"/>`;
      }
      back += `<g clip-path="url(#umbClip)">${d}</g>`;
    }
    if (k === 'snow') {
      for (let i = 0; i < 24; i++) {
        front += `<rect class="w-flake" style="animation-delay:-${rnd(0, 5).toFixed(2)}s;animation-duration:${rnd(4, 6.5).toFixed(2)}s" x="${rnd(.5, 29.5).toFixed(1)}" y="1" width=".4" height=".4" fill="var(--sky)"/>`;
      }
    }
    if (k === 'fog') {
      front += [6, 10, 14].map((y, i) =>
        `<path class="w-fog" style="animation-delay:-${i * 2}s" d="M${3 + i} ${y}c3-.6 6 .6 9 0s6-.6 ${10 - i * 2} 0" fill="none" stroke="var(--t4)" stroke-width=".18" stroke-linecap="round" opacity=".7" shape-rendering="auto"/>`).join('');
    }
    // accessories (critter-local coordinates: the body is x 2..12, y 1.5..7.5)
    if (k === 'snow' || cold) acc += `<rect x="2.6" y="5.9" width="8.8" height="1" fill="var(--olive)"/><rect x="9" y="6.9" width="1.2" height="1.8" fill="var(--olive)"/>`;
    if (k === 'snow') acc += `<rect x="3" y=".3" width="8" height="1.5" fill="var(--blue)"/><rect x="2.6" y="1.4" width="8.8" height=".5" fill="var(--sky)"/><rect x="6.4" y="-.6" width="1.2" height="1" fill="var(--sky)"/>`;
    if (k === 'clear' && day) acc += `<rect x="3.4" y="2.8" width="2.4" height="1.6" fill="#141413"/><rect x="8.4" y="2.8" width="2.4" height="1.6" fill="#141413"/><rect x="5.8" y="3.1" width="2.6" height=".4" fill="#141413"/>`;
    // hot: one bead of sweat that slides down and starts again
    if (hot && day && !wet) acc += `<rect class="w-sweat" x="12.3" y="1.9" width=".6" height=".9" fill="var(--sky)"/>`;
    if (sleepy) back += `<text class="w-z" x="21.6" y="9.6" font-family="Source Serif 4, Georgia, serif" font-size="2.2" font-style="italic" fill="var(--t4)">z</text>`;
    // wind: a few loose gust lines blowing past, and the clouds drift faster
    if (o.windy) {
      back += [[3, 8.5, 7], [1.5, 12, 9], [5, 15.5, 6]].map(([x, y, w], i) =>
        `<path class="w-gust" style="animation-delay:-${(i * 1.1).toFixed(1)}s" d="M${x} ${y}h${w * .7}c${w * .2} 0 ${w * .3}-.9 ${w * .15}-1.2" fill="none" stroke="var(--t4)" stroke-width=".16" stroke-linecap="round" shape-rendering="auto"/>`).join('');
    }
  }
  const umbrella = wet && !empty;
  const armR = `<rect x="11.8" y="${umbrella ? 2.6 : 4}" width="1.2" height="2" fill="var(--clay)"/>`;
  const eyes = sleepy
    ? `<g fill="var(--eye)"><rect x="3.8" y="4.2" width="1.4" height=".5"/><rect x="8.8" y="4.2" width="1.4" height=".5"/></g>`
    : `<g class="w-eyes" fill="var(--eye)"><rect x="4" y="3" width="1" height="2"/><rect x="9" y="3" width="1" height="2"/></g>`;
  const crit = `<g class="w-crit"><g transform="translate(8 9.4)"><g class="w-bod${sleepy ? ' w-sleep' : ''}">
      <g fill="var(--clay-deep)"><rect x="3" y="7" width="1" height="2.6"/><rect x="5" y="7" width="1" height="2.6"/><rect x="8" y="7" width="1" height="2.6"/><rect x="10" y="7" width="1" height="2.6"/></g>
      <rect x="1" y="4" width="1.2" height="2" fill="var(--clay)"/>${armR}
      <rect x="2" y="1.5" width="10" height="6" fill="var(--clay)"/>
      ${eyes}
      ${acc}</g></g></g>`;
  const umb = umbrella ? `<g><rect x="20.3" y="5.6" width=".45" height="6.6" fill="var(--t2)"/>
      <g fill="var(--blue)"><rect x="12" y="1" width="9" height="1"/><rect x="9" y="2" width="15" height="1"/><rect x="7" y="3" width="19" height="1"/><rect x="6" y="4" width="21" height="1.6"/></g>
      <g fill="var(--bg)">${[9, 13, 17, 21, 25].map(x => `<rect x="${x}" y="5.1" width="1" height=".5"/>`).join('')}</g>
      <rect x="16.3" y="0" width=".45" height="1" fill="var(--t2)"/></g>` : '';
  return `<defs><clipPath id="umbClip"><path clip-rule="evenodd" d="M-2 -2H32V19H-2Z M6 5.6H27V19H6Z"/></clipPath>
      <pattern id="whatch" width=".42" height=".42" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width=".1" height=".42" fill="var(--hatch)"/></pattern></defs>
    ${back}<line x1="2" y1="19" x2="28" y2="19" stroke="var(--line)" stroke-width=".08" shape-rendering="auto"/>
    <ellipse cx="15" cy="19.15" rx="5.8" ry=".62" fill="url(#whatch)" shape-rendering="auto"/>${crit}${umb}${front}`;
}

/** One short line of advice. `ahead` is for a day or hour still to come ("now" phrasing would be wrong). */
export function advice(k: Kind, day: boolean, temp: number, units: Units, rainChance: number, o: { windy?: boolean; ahead?: boolean } = {}): string {
  if (k === 'storm') return 'Thunderstorms. A good day to stay in and code.';
  if (o.windy && (k === 'rain' || k === 'drizzle')) return 'Wet and windy. Hold on to that umbrella.';
  if (k === 'rain') return 'Bring an umbrella.';
  if (k === 'drizzle') return 'A light drizzle. A hood will do.';
  if (k === 'snow') return 'Snow! Bundle up out there.';
  if (k === 'fog') return 'Foggy out there. Take it slow.';
  if (rainChance >= 50) return o.ahead ? `A ${rainChance}% chance of rain. Keep an umbrella handy.` : `Dry for now, but a ${rainChance}% chance of rain.`;
  const windy = o.windy;
  if (isCold(temp, units)) return 'Cold one. Grab a coat.';
  if (windy) return 'Breezy out there. Hold on to your hat.';
  if (k === 'clear' && day && isHot(temp, units)) return 'Hot and sunny. Drink some water.';
  if (k === 'clear' && day) return 'Sunglasses weather.';
  if (k === 'clear') return 'Clear skies. Good night for stars.';
  if (k === 'partly') return day ? 'A mix of sun and clouds.' : 'A few clouds tonight.';
  return 'Grey skies, but staying dry.';
}
