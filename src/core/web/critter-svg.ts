// The critter on its own, awake: the same pixel rects as Home's critter (apps/home/view.html, .hm-crit), without
// Home's scene (sky, mug, "!") or its sleepy and busy parts. The lock screen (lock.ts) draws it. Home and the ambient
// screen keep their own markup, so changing this file never changes them. Colours come from core.css tokens
// (--clay, --clay-deep, --eye, --blush), so it follows the theme. No DOM here: tests import it under Node.

/** The critter's box in SVG units: 14 wide, 9.6 tall (arms at 1 and 13, feet down to 9.6). */
export const CRITTER_VIEWBOX = '0 0 14 9.6';

/** The critter as an <svg> string. `cls` is set on the <svg>; the moving part is the inner `.crit-body` group. */
export function critterSvg(cls = ''): string {
  return `<svg${cls ? ` class="${cls}"` : ''} viewBox="${CRITTER_VIEWBOX}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">`
    + '<g class="crit-body">'
    + '<g fill="var(--clay-deep)"><rect x="3" y="7" width="1" height="2.6"/><rect x="8" y="7" width="1" height="2.6"/>'
    + '<rect x="5" y="7" width="1" height="2.6"/><rect x="10" y="7" width="1" height="2.6"/></g>'
    + '<rect x="1" y="4" width="1.2" height="2" fill="var(--clay)"/>'
    + '<rect x="11.8" y="4" width="1.2" height="2" fill="var(--clay)"/>'
    + '<rect x="2" y="1.5" width="10" height="6" fill="var(--clay)"/>'
    + '<g fill="var(--eye)"><rect x="4" y="3" width="1" height="2"/><rect x="9" y="3" width="1" height="2"/></g>'
    + '<g fill="var(--blush)"><rect x="3" y="5.3" width="1.2" height=".6"/><rect x="9.8" y="5.3" width="1.2" height=".6"/></g>'
    + '</g></svg>';
}
