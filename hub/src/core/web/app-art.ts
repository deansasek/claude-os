// Hand-inked app icon in the Weather icon's style (an Anthropic spot illustration): a loose ink line in the
// text colour, drawn over a smaller clay blob that sits off-register, so the ink runs over its edge.
// Used where apps are shown big (the Apps screen). The rail keeps the plain line icons.
//
//   appArt('claude')              → the drawn icon for a Claude Home app, or null if it has none
import { SPARK_PATH } from './dom.ts';
import { blob, loop, rng } from './ink.ts';

const PEN = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const DRAW: Record<string, () => string> = {
  // the logo stays clay: the spark in clay over a pale clay blob, with a thin ink loop around it
  claude: () =>
    `<svg viewBox="0 0 32 32" class="ic ic-spot ic-art"><path d="${blob(17.5, 17.5, 12, 11, rng(222), 8, .1)}" fill="var(--clay)" opacity=".22"/>`
    + `<path d="${loop(16, 16, 12.5, 12.5, rng(22), .05)}" ${PEN} stroke-width="1.6"/>`
    + `<g transform="translate(16 16) scale(.19)"><path d="${SPARK_PATH}" fill="var(--clay)"/></g></svg>`,
};

const cache = new Map<string, string>();
/** The drawn icon for a Claude Home app (by id), or null when it has none. */
export function appArt(app: string): string | null {
  if (!DRAW[app]) return null;
  if (!cache.has(app)) cache.set(app, DRAW[app]());
  return cache.get(app)!;
}
