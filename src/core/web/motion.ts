// Claude Home's shared motion: one pressed state for everything you can tap, and a few helpers.
// The tokens (durations, easings, --press-filter, --rise) live at the top of public/core.css.
//
// Pressed state
//   Anything tappable sinks in by about 3px and darkens a touch (lightens a touch in dark mode)
//   while your finger is on it, and settles back when you lift or start scrolling. It's driven
//   from here with the Web Animations API on `scale` and `filter`, so it never fights an
//   element's own `transform`, `transition` or `all: unset`, and stays on the compositor.
//
//   On by default for: <button>, [role=button], the rail, control-center tiles and rows, banners.
//   Apps opt other elements in, or tune them, with an attribute:
//     data-press          press like a button (rows, cards, a tappable div)
//     data-press="soft"   darken only, no scale (very large surfaces, full-width rows)
//     data-press="off"    no core feedback (the element draws its own)
//   Disabled buttons and the keyboard's keys (which draw their own) are skipped.
//
//   With prefers-reduced-motion, pressing only darkens.

const PRESSABLE = 'button, [role="button"], [data-press], .ri, .cc-tile, .cc-note, .banner, .app-hd-tap';
const SKIP = '[data-press="off"], .kb-keys button, :disabled, [aria-disabled="true"]';
const SINK_PX = 3;            // how far an edge moves in when pressed
const MIN_SHOW_MS = 90;       // a quick tap still shows a press
const MOVE_SLOP = 10;         // finger moved this far: it's a scroll or a swipe, not a press

const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
/** The person asked for less motion: the system setting, or Settings → Appearance (or low power mode). */
export const reducedMotion = (): boolean => reducedQuery.matches || document.documentElement.classList.contains('reduce-motion');

const css = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
/** A motion token in ms, e.g. motionMs('--dur-base') → 220. */
export function motionMs(name: string): number {
  const v = css(name);
  return v.endsWith('ms') ? parseFloat(v) : v.endsWith('s') ? parseFloat(v) * 1000 : 0;
}

const canScale = typeof CSS !== 'undefined' && CSS.supports?.('scale', '1');

interface Press { el: HTMLElement; anim: Animation; t0: number; x: number; y: number; id: number }
let press: Press | null = null;

function start(e: PointerEvent): void {
  if (e.button > 0 || !e.isPrimary) return;
  const el = (e.target as Element | null)?.closest?.<HTMLElement>(PRESSABLE);
  if (!el || !el.animate || el.matches(SKIP)) return;
  end(true);
  const soft = el.dataset.press === 'soft' || reducedMotion() || !canScale;
  // the same sink in px whatever the size: small buttons scale more, wide rows hardly at all
  const size = Math.max(el.offsetWidth || 0, el.offsetHeight || 0) || 60;
  const s = Math.min(.985, Math.max(.95, 1 - (2 * SINK_PX) / size));
  const filter = css('--press-filter') || 'brightness(.94)';
  const to: Keyframe = soft ? { filter } : { filter, scale: String(s) };
  const from: Keyframe = soft ? { filter: 'none' } : { filter: 'none', scale: '1' };
  const anim = el.animate([from, to], { duration: motionMs('--dur-fast') || 120, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'forwards' });
  press = { el, anim, t0: performance.now(), x: e.clientX, y: e.clientY, id: e.pointerId };
}

function end(now = false): void {
  const p = press;
  if (!p) return;
  press = null;
  const release = () => {
    try {
      p.anim.reverse();   // settle back the way it went in
      p.anim.onfinish = () => p.anim.cancel();
    } catch { p.anim.cancel(); }
  };
  const left = MIN_SHOW_MS - (performance.now() - p.t0);
  if (now || left <= 0) release(); else setTimeout(release, left);
}

/** Wire the shared pressed state (once, from the shell). */
export function initMotion(): void {
  const opts = { capture: true, passive: true } as const;
  document.addEventListener('pointerdown', start, opts);
  document.addEventListener('pointerup', () => end(), opts);
  document.addEventListener('pointercancel', () => end(true), opts);
  document.addEventListener('pointermove', e => {
    if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_SLOP) end(true);
  }, opts);
  addEventListener('blur', () => end(true));
}
