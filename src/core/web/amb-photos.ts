// The photo frame on the ambient screen: the family's photos from the Photos app, one at a time, full screen behind
// the clock. A new one every 20 s, fading over about 2 s (no fade with reduced motion: core.css). Picked at random
// from the library, each photo once before any repeats. The list is fetched when the ambient screen shows and once an
// hour while it stays. Photos come through the photo file route at its thumbnail size (the full picture only for a
// photo with no thumbnail yet: the route falls back by itself).
//
// Nothing runs unless the ambient screen is on and visible: system.ts calls startFrame() / stopFrame() as the ambient
// screen comes and goes, and a hidden page (screen off) pauses the timers. An empty library leaves the ambient screen
// without photos: the layers stay empty and .amb never gets .photo. A failed re-read keeps the last list, so the photo
// on screen stays. Only a first read with no list leaves the frame without photos.
import { getJson } from './dom.ts';
import { thumbUrl, type PhotoList } from '../../apps/photos/api.ts';

const EVERY_MS = 20e3;
const LIST_MS = 60 * 60e3;
const MAX_MISSES = 3;   // pictures in a row that won't load before the frame gives up until the next list

let host: HTMLElement | null = null;   // #amb
let layers: HTMLImageElement[] = [];
let front = -1;                         // the layer showing, or -1
let running = false;
let ids: string[] = [];
let bag: string[] = [];                 // what's left of this round, shuffled
let last = '';
let listAt = 0;
let nextTimer: number | undefined, listTimer: number | undefined, clearTimer: number | undefined;
let misses = 0;
let gen = 0;                            // bumps on every start / stop, so a late load from before is dropped

/** Build the two image layers inside the ambient screen (once, from system.ts). */
export function mountFrame(amb: HTMLElement): void {
  host = amb;
  const box = document.createElement('div');
  box.className = 'amb-photo';
  box.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 2; i++) {
    const img = document.createElement('img');
    img.alt = ''; img.decoding = 'async'; img.draggable = false;
    box.appendChild(img);
    layers.push(img);
  }
  amb.insertBefore(box, amb.firstChild);
  document.addEventListener('visibilitychange', () => {
    if (!running) return;
    if (document.hidden) pause(); else resume();
  });
}

/** The ambient screen came on (and the frame is turned on in Settings). */
export function startFrame(): void {
  if (!host) return;
  clearTimeout(clearTimer);
  running = true;
  gen++;
  if (!document.hidden) resume(true);
}

/** The ambient screen went away, or the frame was turned off. Off at once: the layers empty after the wake fade. */
export function stopFrame(now = false): void {
  running = false;
  gen++;
  pause();
  clearTimeout(clearTimer);
  if (now) blank(); else clearTimer = window.setTimeout(blank, 1500);
}

function pause(): void {
  clearTimeout(nextTimer); nextTimer = undefined;
  clearTimeout(listTimer); listTimer = undefined;
}

// fetch the list when shown (fresh) or after an hour, then show a photo
function resume(fresh = false): void {
  pause();
  const g = gen;
  const due = fresh || Date.now() - listAt >= LIST_MS;
  void (due ? loadList() : Promise.resolve()).then(() => {
    if (g !== gen || !running || document.hidden) return;
    listTimer = window.setTimeout(() => resume(), Math.max(1e3, LIST_MS - (Date.now() - listAt)));
    if (!ids.length) { blank(); return; }
    // keep the photo already showing if there is one and it's still in the library; otherwise show one now
    const cur = front >= 0 ? layers[front].dataset.id : undefined;
    if (cur && ids.includes(cur)) arm(); else void next();
  });
}

async function loadList(): Promise<void> {
  try {
    const r = await getJson<PhotoList>('/api/photos/list?limit=500');
    if (!r || r.ok !== true || !Array.isArray(r.days)) throw new Error('bad list');
    const seen = new Set<string>();
    for (const d of r.days) for (const p of d.photos || []) if (p && typeof p.id === 'string') seen.add(p.id);
    ids = [...seen];
    bag = bag.filter(id => seen.has(id));
    listAt = Date.now();
    misses = 0;
  } catch {
    // the PC is away: keep the last list and try again in five minutes
    listAt = Date.now() - LIST_MS + 5 * 60e3;
  }
}

function pick(): string | null {
  if (!ids.length) return null;
  if (!bag.length) {
    bag = ids.slice();
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    if (bag.length > 1 && bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
  }
  return bag.pop() ?? null;
}

function arm(): void {
  clearTimeout(nextTimer);
  if (running && !document.hidden) nextTimer = window.setTimeout(() => void next(), EVERY_MS);
}

// load the next photo on the hidden layer, and fade it in only once it has decoded (never a half-drawn picture)
async function next(): Promise<void> {
  const g = gen, id = pick();
  if (!id) { blank(); return; }
  const back = front === 0 ? 1 : 0, img = layers[back];
  img.classList.remove('show');
  try {
    img.src = thumbUrl(id);
    await img.decode();
    if (g !== gen || !running) return;
    if (!img.naturalWidth) throw new Error('empty');
  } catch {
    if (g !== gen || !running) return;
    img.removeAttribute('src');
    // a photo that won't load is skipped; after a few in a row the frame waits for the next list
    if (++misses >= MAX_MISSES) { if (front < 0) blank(); arm(); return; }
    void next();
    return;
  }
  misses = 0;
  last = id;
  img.dataset.id = id;
  img.classList.add('show');
  if (front >= 0) layers[front].classList.remove('show');
  front = back;
  host?.classList.add('photo');
  arm();
}

function blank(): void {
  host?.classList.remove('photo');
  for (const img of layers) { img.classList.remove('show'); img.removeAttribute('src'); delete img.dataset.id; }
  front = -1;
}
