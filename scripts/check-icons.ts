// Checks ClaudeOS's app icons against the Weather icon's style (the rules are ICON_RULES in src/core/web/app-icons.ts).
//   1. Every icon from app-icons.ts, and the Weather icon itself (the reference), is drawn on the 32 grid with
//      one 1.8 pen (2 on the clay spot), round ends and joins, no fills but small dots, and only the allowed colours.
//   2. Every app takes its rail icon from app-icons.ts (Claude keeps its clay spark; Weather draws its own icon).
// Run with: npm run check:icons. Pass a folder to check a different root (the default is the repository root).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The icon modules are browser code: core/web/dom.ts reads `location` when it loads, so give Node a blank one first.
(globalThis as { location?: unknown }).location ??= { search: '', hash: '', pathname: '/', href: 'http://localhost/' };
const { APP_ICONS, ICON_PEN, ICON_VIEWBOX, appIcon, clockIcon } = await import('../src/core/web/app-icons.ts');
const { WMO, icon: weatherIcon } = await import('../src/apps/weather/web/art.ts');

const COLOURS = new Set(['none', 'currentColor', 'var(--clay)', 'var(--blue)', 'var(--ic-bg, var(--bg))']);
const DRAWN = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
/** Apps that keep their own icon: Claude's clay spark is the brand mark; Weather's icon is the reference. */
export const OWN_ICON = new Set(['claude', 'weather']);
/** Files outside src/apps that draw an app's rail icon. */
const RAIL_FILES = ['src/core/web/voice-ui.ts'];

const attrsOf = (s: string): Record<string, string> =>
  Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
const scaleOf = (t = ''): number => { const m = t.match(/scale\(([\d.]+)/); return m ? +m[1] : 1; };

interface IconOpts {
  /** Check that every coordinate stays near the 4..28 drawing area (app icons; Weather's rain and snow use the margin). */
  bounds?: boolean;
}

/** What is wrong with one icon's SVG markup ([] when it follows the rules). */
export function iconProblems(svg: string, opts: IconOpts = {}): string[] {
  const out: string[] = [];
  const root = svg.match(/^<svg\b([^>]*)>/);
  if (!root) return ['does not start with <svg>'];
  const rootAttrs = attrsOf(root[1]);
  if (rootAttrs.viewBox !== ICON_VIEWBOX) out.push(`viewBox is "${rootAttrs.viewBox}", not "${ICON_VIEWBOX}"`);
  if (/<(image|text|foreignObject)\b/.test(svg)) out.push('uses <image>, <text> or <foreignObject>: icons are vector paths only');
  if (/\p{Extended_Pictographic}/u.test(svg)) out.push('contains an emoji');
  if (/#[0-9a-f]{3,8}\b/i.test(svg)) out.push('uses a hex colour: use currentColor, var(--clay) or var(--blue)');
  const pen = /\bic-spot\b/.test(rootAttrs.class ?? '') ? 2 : ICON_PEN;

  // walk the elements, carrying the inherited pen down through <svg> and <g>
  type Pen = Record<string, string>;
  const stack: Pen[] = [];
  for (const m of svg.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
    const [, close, tag, rest, self] = m;
    if (close) { if (tag === 'g' || tag === 'svg') stack.pop(); continue; }
    const own = attrsOf(rest);
    const inherited = Object.assign({}, ...stack) as Pen;
    const eff: Pen = { ...inherited, ...own };
    for (const k of ['fill', 'stroke']) {
      if (own[k] != null && !COLOURS.has(own[k])) out.push(`<${tag}> ${k}="${own[k]}" is not an allowed colour`);
    }
    if (DRAWN.has(tag)) {
      const stroked = eff.stroke != null && eff.stroke !== 'none';
      if (stroked) {
        const w = parseFloat(eff['stroke-width'] ?? 'NaN') * scaleOf(own.transform);
        if (!(Math.abs(w - pen) < .02)) out.push(`<${tag}> draws with a ${Number.isNaN(w) ? 'default' : w.toFixed(2)} pen, not ${pen}`);
        if (eff['stroke-linecap'] !== 'round') out.push(`<${tag}> has no round line caps`);
        if (eff['stroke-linejoin'] !== 'round') out.push(`<${tag}> has no round line joins`);
        if (eff.fill == null) out.push(`<${tag}> has no fill="none" (the default fill is black)`);
      } else {
        // a fill with no line: only small dots, or the clay spot behind a drawing
        const dot = tag === 'circle' && parseFloat(own.r ?? '99') <= 1.2;
        const spot = /\bic-spot\b/.test(rootAttrs.class ?? '') && eff.fill === 'var(--clay)';
        if (!dot && !spot) out.push(`<${tag}> is a filled shape: draw it as a line (only dots of radius 1.2 or less may be filled)`);
      }
      if (opts.bounds) {
        const nums = (own.d ?? '').match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
        if (nums.some(n => n < 2.5 || n > 29.5)) out.push(`<${tag}> reaches outside the drawing area (keep within 4..28)`);
      }
    }
    if ((tag === 'g' || tag === 'svg') && !self) stack.push(own);
  }
  return out;
}

/** Every icon to check, by a readable name. */
export function allIcons(): { name: string; svg: string; bounds: boolean }[] {
  const list = APP_ICONS.map(n => ({ name: `app-icons ${n}`, svg: appIcon(n), bounds: true }));
  for (let h = 0; h < 24; h += 5) list.push({ name: `app-icons clock ${h}:${h * 2}`, svg: clockIcon(new Date(2026, 0, 1, h, h * 2)), bounds: true });
  for (const code of Object.keys(WMO).map(Number)) {
    for (const day of [true, false]) {
      list.push({ name: `weather ${code} ${day ? 'day' : 'night'}`, svg: weatherIcon(code, day), bounds: false });
      list.push({ name: `weather ${code} ${day ? 'day' : 'night'} spot`, svg: weatherIcon(code, day, { blob: true }), bounds: false });
    }
  }
  return list;
}

/** Apps (by folder) whose rail icon does not come from app-icons.ts, and rail files that draw their own. */
export function sourceProblems(root: string): string[] {
  const out: string[] = [];
  const apps = path.join(root, 'src', 'apps');
  for (const dir of fs.readdirSync(apps)) {
    const file = path.join(apps, dir, 'web', 'index.ts');
    if (OWN_ICON.has(dir) || !fs.existsSync(file)) continue;
    if (!/from '\.\.\/\.\.\/\.\.\/core\/web\/app-icons\.ts'/.test(readAll(path.join(apps, dir, 'web')))) {
      out.push(`src/apps/${dir}: the app icon does not come from src/core/web/app-icons.ts`);
    }
  }
  for (const rel of RAIL_FILES) {
    if (!/from '\.\/app-icons\.ts'/.test(fs.readFileSync(path.join(root, rel), 'utf8'))) out.push(`${rel}: the rail icon does not come from app-icons.ts`);
  }
  return out;
}
function readAll(dir: string): string {
  return fs.readdirSync(dir, { recursive: true }).map(String).filter(f => f.endsWith('.ts'))
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
}

/** Every problem in the repository at `root` ([] when all icons follow the rules). */
export function checkIcons(root: string): string[] {
  const out = sourceProblems(root);
  for (const { name, svg, bounds } of allIcons()) for (const p of iconProblems(svg, { bounds })) out.push(`${name}: ${p}`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const errors = checkIcons(root);
  if (errors.length) {
    console.error('icon check failed:');
    for (const e of errors) console.error('  - ' + e);
    process.exitCode = 1;
  } else {
    console.log(`icons ok: ${allIcons().length} icons follow the Weather icon's style`);
  }
}
