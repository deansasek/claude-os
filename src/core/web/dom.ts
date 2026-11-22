// Small DOM helpers shared by every app.

export const params = new URLSearchParams(location.search);
/** The PC stand-in tablet (mock-device.ts). Dev-only hooks check this; it is false on the real tablet and the Nest Hub. */
export const mockDevice = /[?&]device=mock\b/.test(location.search);
export const SVGNS = 'http://www.w3.org/2000/svg';

export function $<T extends Element = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as unknown as T;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, c => ESC[c]);

/** localStorage that never throws (private windows, blocked storage). Every write also fires `hub:store` on window
 *  (detail: the key), so a clock that only needs to tick while a timer runs can wait for the change instead of polling. */
export const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null): void {
    try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ }
    try { dispatchEvent(new CustomEvent('hub:store', { detail: k })); } catch { /* ignore */ }
  },
};
/** Run fn(key) after a store write. Asynchronous, so the writer's own state is in place first. */
export function onStore(fn: (key: string) => void): void {
  addEventListener('hub:store', e => { const k = (e as CustomEvent<string>).detail; setTimeout(() => fn(k), 0); });
}

/** Tell the server about a tap (it logs them; handy for testing on the Hub). */
export function report(target: string): void {
  fetch('/api/core/tap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }) }).catch(() => {});
}

/** Restart a CSS animation class on an element. */
export function replay(el: Element, cls: string): void {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  return r.json() as Promise<T>;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json() as Promise<T>;
}

/** The Claude spark: the official shape (traced from the user's reference image), centred in a -50..50 box. */
export const SPARK_PATH = 'M-22.1 -49.9L-18.1 -49.4L-16.2 -48L-9.9 -33.5L-1 -16.2L0.4 -11.8L1.1 -12L1.5 -19.6L2.7 -28.9L3.8 -42.7L5.4 -46.4L8.6 -48.4L10.9 -47.4L13 -44.3L11.6 -35.2L8.8 -22.3L7.6 -14.6L8.4 -14.6L9 -15.3L20.9 -30.4L23.4 -33.3L27.4 -37.3L29.2 -38.7L33.6 -38.7L36.6 -34.2L35.3 -29.2L21.8 -11.8L18.7 -6L19 -5.7L20.1 -5.7L32.2 -8.4L45.6 -10.7L49.2 -9L49.5 -7.3L48.2 -4.1L15.9 3.3L16.2 3.7L22.8 4.3L32.3 4.4L44.2 5.4L45.2 5.7L48.2 7.7L49.8 10.1L49.5 12L44.5 14.6L16.6 8L15.5 8.1L15.5 8.4L19.4 12.3L39 30.2L39.4 32.6L38.3 34.3L36.7 34.2L35.5 33.3L27.6 27.2L16 17.4L15.5 17.6L15.5 18.3L26.9 35.4L27.6 40.2L26.8 41.5L24.4 42.4L21.6 41.8L14.8 32.4L9.8 24.9L5.3 16.8L4.8 16.8L4.5 17.1L4.4 17.9L1.7 47L0.4 48.8L-2.6 49.9L-5.2 47.9L-6.4 45.2L-6.4 44.6L-2.1 24.5L-1 16.5L-0.3 14.1L-0.4 13.7L-1 13.7L-15.9 34.1L-22.2 40.9L-23.3 41.9L-24.8 42.6L-27.9 41.1L-27.6 38.3L-26 36L-10.4 15.8L-6 10.8L-6.1 10.2L-7.8 11L-32.8 27.3L-37.4 28L-39.4 26L-39.2 23L-38.2 21.9L-29.8 16.2L-11.2 5.9L-10.6 5.4L-10.4 4.6L-10.8 3.9L-26.3 3.5L-45.7 2.4L-47.9 1.9L-49.9 -1L-49.7 -2.4L-47.9 -3.7L-22.9 -2.1L-12.8 -0.9L-10.5 -0.9L-10.3 -1.1L-10.2 -1.6L-11.2 -2.6L-31.4 -15.9L-40.1 -22L-41.7 -24.3L-42.2 -28.3L-39.6 -31.2L-35.1 -30.8L-11.8 -13L-11.4 -12.8L-10.8 -13.3L-16.9 -25.1L-25.8 -40.1L-26.6 -43.3L-26.7 -45.4L-23.9 -49.3L-22.2 -49.8Z';
export const SPARK_SHAPE = `<path d="${SPARK_PATH}"/>`;

/** Draw the spark into every .spark-rays group (they're all in a -50..50 box). */
export function renderSparks(): void {
  document.querySelectorAll('.spark-rays').forEach(g => { g.innerHTML = SPARK_SHAPE; });
}

// Something of Android's covers the right edge of the screen (Chrome's sign-in side sheet): the stage fits into
// the space left of it. CSS px; 0 when nothing covers it.
let insetRight = 0;
let refit: (() => void) | null = null;
let insetTimer = 0;

/**
 * Fits the stage into the screen minus `right` CSS px on the right, or the whole screen again with 0. The whole
 * 1024-wide stage is scaled, not reflowed, so every app keeps its layout; its height stays what the full screen
 * gave it, so nothing inside moves. It glides there with the motion tokens (slow, emphasized) and dispatches
 * 'hub:stage' on window once it has settled, for anything that places native views over the stage. While an
 * inset is on, the stage has the class `inset` (core.css hides the edge handles meanwhile). Returns true when the
 * stage moves (and so 'hub:stage' will follow), false when nothing changed.
 */
export function setStageInset(right: number): boolean {
  const r = Math.max(0, Math.round(right));
  if (r === insetRight) return false;
  insetRight = r;
  const stage = document.getElementById('stage');
  if (!stage) return false;
  stage.classList.toggle('inset', r > 0);
  const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-slow')) || 380;
  stage.style.transition = 'transform var(--dur-slow) var(--ease-emph)';
  refit?.();
  clearTimeout(insetTimer);
  insetTimer = window.setTimeout(() => {
    stage.style.transition = '';
    dispatchEvent(new CustomEvent('hub:stage'));
  }, ms + 40);
  return true;
}

/** Fit the fixed 1024x600 stage to whatever screen this is on. */
export function fitStage(): void {
  // The layout is drawn for 1024 wide. On squarer screens (the tablet's 1280×800) the stage grows
  // a little taller instead of leaving bars above and below; apps anchor their bottom strip to the bottom.
  // Measure the visible viewport: on Android, anything spilling past the edge widens innerWidth itself.
  // With an inset (setStageInset) the same stage is scaled into the width left of it and centred there.
  const fit = () => {
    const stage = $('stage');
    // the inset is this page's own state: it starts (and on every fit, so after a missed close) as the class says
    stage.classList.toggle('inset', insetRight > 0);
    const vv = window.visualViewport;
    const vw = vv ? vv.width * vv.scale : innerWidth;
    const vh = vv ? vv.height * vv.scale : innerHeight;
    const h = Math.round(Math.min(700, Math.max(600, 1024 * vh / vw)));
    stage.style.height = `${h}px`;
    const aw = Math.max(320, vw - insetRight);
    const s = Math.min(aw / 1024, vh / h);
    // the stage's left/top are 50% of the screen: shift the centre to the middle of the free width
    const dx = -(vw - aw) / 2;
    stage.style.transform = `translate(${dx}px, 0px) scale(${s}) translate(-50%, -50%)`;
  };
  refit = fit;
  addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
  fit();
  // The stage never scrolls. It has overflow: hidden, but the browser still scrolls it when something
  // inside gets focus or is scrolled into view (e.g. a hidden keyboard field near the bottom), which
  // pushes the whole screen up. Snap it back whenever that happens; the same for the page itself.
  const stage = $('stage');
  const pin = () => {
    if (stage.scrollTop || stage.scrollLeft) { stage.scrollTop = 0; stage.scrollLeft = 0; }
    const se = document.scrollingElement;
    if (se && (se.scrollTop || se.scrollLeft)) { se.scrollTop = 0; se.scrollLeft = 0; }
  };
  stage.addEventListener('scroll', pin);
  addEventListener('scroll', pin);
  addEventListener('focusin', () => requestAnimationFrame(pin));
  pin();
}
