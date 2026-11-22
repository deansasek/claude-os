// Dev guard for the tap areas (mock device only, ?device=mock). Every .hit control (and the .seg buttons and .backnow,
// which have the same ::before) must be position: relative, and its ::before must stay close to the control. Otherwise
// the ::before positions against a far ancestor and covers large areas, stealing taps and scrolls (see core.css).
// It only reads styles and warns in the console; it never changes the page.
import { mockDevice } from './dom.ts';

const SEL = '.hit, .seg button, .backnow';
/** How far (CSS px) a ::before may reach past its control on any side before it is flagged. */
const MAX_OVERHANG = 30;
const warned = new WeakSet<Element>();

const px = (v: string): number => (v === 'auto' || v === '' ? 0 : parseFloat(v) || 0);

function label(el: Element): string {
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).map(c => `.${c}`).join('') : '';
  return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls}`;
}

/** What is wrong with this control's tap area, or '' when it is fine. */
function problemOf(el: HTMLElement): string {
  const cs = getComputedStyle(el);
  if (cs.position === 'static') return 'position is static, so its ::before covers the nearest positioned ancestor';
  const pb = getComputedStyle(el, '::before');
  if (pb.content === 'none' || pb.content === 'normal') return '';
  // Both sizes must be in layout px. The stage is scaled by a CSS transform (fitStage in dom.ts), and
  // getBoundingClientRect() returns scaled px while getComputedStyle() does not, so comparing them made every
  // wide control look like it had a large overhang at any scale below 1. offsetWidth/offsetHeight are unscaled.
  // core.css gives the ::before min(0px, calc(50% - 22px)) insets, so it is exactly max(44px, size) on each axis:
  // the tap area is the 44px floor, and anything beyond that is the overhang. A size of 'auto' means no box (not
  // rendered): nothing to measure.
  const lw = el.offsetWidth, lh = el.offsetHeight;
  const overX = pb.width === 'auto' ? 0 : (px(pb.width) - Math.max(44, lw)) / 2;
  const overY = pb.height === 'auto' ? 0 : (px(pb.height) - Math.max(44, lh)) / 2;
  const worst = Math.max(overX, overY);
  if (worst <= MAX_OVERHANG) return '';
  return `its ::before reaches about ${Math.round(worst)}px past the control (the limit is ${MAX_OVERHANG}px)`;
}

/**
 * Checks every visible tap area on the page. Returns a message for each one that is wrong (all of them, every call);
 * each newly found one is also logged once with console.warn. Does nothing unless this is the mock device.
 */
export function checkHitAreas(): string[] {
  if (!mockDevice) return [];
  const out: string[] = [];
  document.querySelectorAll<HTMLElement>(SEL).forEach(el => {
    if (el.getClientRects().length === 0) return;   // hidden: no box to check yet
    const why = problemOf(el);
    if (!why) return;
    const msg = `${label(el)}: ${why}`;
    out.push(msg);
    if (!warned.has(el)) { warned.add(el); console.warn('[hit area] ' + msg, el); }
  });
  return out;
}
