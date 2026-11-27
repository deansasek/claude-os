// The Photos app: the pictures the Camera took, by day, newest first. Tap one to see it full size: pinch or double-tap
// to zoom, swipe or use the arrows to go on, and delete it or ask Claude about it. Select several in the grid (Select,
// or hold a photo) to delete them together, or to ask Claude about up to three.
// Nothing is removed from the list until the PC says it is gone: a delete that fails leaves the photo where it was.
import { esc, getJson, postJson, report } from '../../../core/web/dom.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { onBack, openApp } from '../../../core/web/system.ts';
import { askWithPhoto } from '../../claude/web/reply.ts';
import { ASK_MAX_PHOTOS, deleteBatches, nextPhotoDays, thumbUrl, toggleDay } from '../api.ts';
import type { PhotoDay, PhotoDeleteResult, PhotoItem, PhotoList } from '../api.ts';
import { manifest } from '../manifest.ts';
import { backfillActive, backfillThumb } from './thumb.ts';

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);
let days: PhotoDay[] = [];
let listFailed = false;                  // the last list could not be read: the empty panel must not claim the gallery is empty
let more = false;                        // the last list stopped at its limit: older photos are not shown
// the grid picture of a photo with no thumbnail on the PC yet: its thumbnail once made, or its full picture if the PC
// could not make one. Kept across reloads of the list, which still say "no thumbnail" until the next one.
const thumbSrc = new Map<string, string>();
const asked = new Set<string>();         // photos whose thumbnail is being made (or was tried this session)
let shown: PhotoItem | null = null;      // the photo in the viewer
let selecting = false;                   // the grid's select mode
const picked = new Set<string>();        // the photos picked in select mode
let pending: string[] = [];              // the photo ids the open sheet would delete
let pressTimer: number | undefined;      // a long-press in progress
let pressAt = { x: 0, y: 0 };
let suppressClick = false;               // the tap that ends a long-press is not a tap
const loaded = new Set<string>();        // picture addresses already shown: repainting the grid does not fade them again

// the viewer's zoom: the picture's scale, and how far it is moved from the middle of the stage (px)
const zoom = { s: 1, x: 0, y: 0 };
const MAX_ZOOM = 4;
const touches = new Map<number, { x0: number; y0: number; x: number; y: number }>();   // pointers on the picture
let pinchD = 0;                          // the distance between two fingers at the last move
let moved = false;                       // a finger went far enough (or two fingers came down): not a tap
let swipeAt: { x: number; y: number } | null = null;   // where a finger went down on the viewer's picture
let lastTap = { t: 0, x: 0, y: 0 };

const ICON = appIcon('photos');

const dayLabel = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d), now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  if (dt.getTime() === today.getTime()) return 'Today';
  if (dt.getTime() === yest.getTime()) return 'Yesterday';
  if (dt.getTime() >= monday.getTime() && dt.getTime() < yest.getTime()) return 'Earlier this week';
  return dt.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: dt.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
};
const timeOf = (at: string): string => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function paint(): void {
  const total = days.reduce((n, d) => n + d.photos.length, 0);
  $('phCount').textContent = more ? 'Newest 500 photos' : total ? `${total} ${total === 1 ? 'photo' : 'photos'}` : '';
  $('phEmpty').hidden = total > 0 || listFailed;
  // days that read the same ("Earlier this week") share one heading
  const groups: { label: string; photos: PhotoItem[] }[] = [];
  for (const d of days) {
    const label = dayLabel(d.day), last = groups[groups.length - 1];
    if (last && last.label === label) last.photos.push(...d.photos);
    else groups.push({ label, photos: [...d.photos] });
  }
  groupIds = groups.map(g => g.photos.map(p => p.id));
  $('phDays').innerHTML = groups.map((g, gi) => `
    <section>
      <h3 class="ph-dayhd" data-group="${gi}">${esc(g.label)}<span>${g.photos.length}</span></h3>
      <div class="ph-grid">${g.photos.map(p => {
        const on = picked.has(p.id);
        const src = gridSrc(p);
        return `<button class="ph-cell${on ? ' sel' : ''}" data-id="${esc(p.id)}" aria-label="Photo at ${esc(timeOf(p.at))}"${on ? ' aria-pressed="true"' : ''}>`
          + `<img class="${src && loaded.has(src) ? 'in' : ''}" loading="lazy" decoding="async"${src ? ` src="${esc(src)}"` : ''} alt="" onerror="this.closest('.ph-cell').classList.add('gone')"><i class="ph-tick" aria-hidden="true"></i></button>`;
      }).join('')}</div>
    </section>`).join('');
  paintSelect();
  backfill();
}

/** The address a grid picture loads from: its thumbnail; empty (the card shows) while a photo's thumbnail is being made. */
const gridSrc = (p: PhotoItem): string => (p.hasThumb ? thumbUrl(p.id) : thumbSrc.get(p.id) ?? '');

/**
 * Photos with no thumbnail get one, made here from the picture (see thumb.ts: two at a time, only while Photos is on
 * screen). Each cell's picture is switched to the thumbnail when the PC keeps it.
 */
function backfill(): void {
  for (const d of days) for (const p of d.photos) {
    if (p.hasThumb || asked.has(p.id)) continue;
    asked.add(p.id);
    void backfillThumb(p.id, p.url).then(ok => {
      const src = ok ? thumbUrl(p.id) : p.url;   // the PC refused it: show the full picture, as before
      thumbSrc.set(p.id, src);
      const img = $('phDays').querySelector<HTMLImageElement>(`.ph-cell[data-id="${p.id}"] img`);
      if (img && img.getAttribute('src') !== src) img.src = src;
    });
  }
}

/** The select bar and the grid's mode, from `selecting` and `picked`. */
function paintSelect(): void {
  const total = days.reduce((n, d) => n + d.photos.length, 0);
  const n = picked.size, tooMany = n > ASK_MAX_PHOTOS;
  ctx.root.classList.toggle('selecting', selecting);
  $('phSelCount').textContent = !n ? 'Select photos' : tooMany ? `${n} selected · Claude takes ${ASK_MAX_PHOTOS}` : `${n} selected`;
  $('phSelAll').textContent = total && n === total ? 'Deselect all' : 'Select all';
  $<HTMLButtonElement>('phSelAll').disabled = total === 0;
  $<HTMLButtonElement>('phSelAsk').disabled = n === 0 || tooMany;
  $<HTMLButtonElement>('phSelDel').disabled = n === 0;
  $('phSelect').hidden = selecting || total === 0;   // the header's way in: the long-press is the quicker one
}

function setSelecting(on: boolean): void {
  selecting = on;
  if (!on) picked.clear();
  paint();
}

function togglePick(id: string): void {
  if (picked.has(id)) picked.delete(id); else picked.add(id);
  paint();
}

/** The photo ids of each heading group, in the order paint() shows them. A tap on a heading picks that group. */
let groupIds: string[][] = [];

/** Pick every photo, or clear the picks when they are all picked already. */
function selectAll(): void {
  const ids = inOrder().map(x => x.p.id);
  const all = ids.length > 0 && ids.every(id => picked.has(id));
  picked.clear();
  if (!all) for (const id of ids) picked.add(id);
  paint();
}

async function load(): Promise<void> {
  try {
    const l = await getJson<PhotoList>('/api/photos/list');
    // a list the PC could not read keeps the photos already in the grid
    days = nextPhotoDays(days, l);
    more = l.ok !== false ? l.more === true : more;
    listFailed = l.ok === false;
    // the PC answered but could not read its folder: say so, rather than an empty gallery
    $('phNote').hidden = l.ok !== false;
    if (l.ok === false) $('phNote').textContent = l.error || 'The PC couldn’t read its photos folder.';
  } catch {
    listFailed = true;
    $('phNote').hidden = false;
    $('phNote').textContent = 'Can’t reach your PC just now. The photos will show when it answers.';
  }
  const have = new Set(days.flatMap(d => d.photos.map(p => p.id)));
  for (const id of [...picked]) if (!have.has(id)) picked.delete(id);
  paint();
}

/** Every photo in the order the grid shows them (newest first, top to bottom). */
const inOrder = (): { p: PhotoItem; day: string }[] => days.flatMap(d => d.photos.map(p => ({ p, day: d.day })));

/** dir: -1 for the photo before this one in the grid, +1 for the one after; 0 when the viewer first opens. */
function open(p: PhotoItem, day: string, dir = 0): void {
  shown = p;
  resetZoom(true);
  const img = $<HTMLImageElement>('phFull');
  img.src = p.url;
  paintMissing(false);
  img.classList.remove('swap');
  if (dir) {
    void img.offsetWidth;   // restart the slide-in
    img.style.setProperty('--from', `calc(var(--rise) * ${dir * 3})`);
    img.classList.add('swap');
  }
  $('phWhen').textContent = `${dayLabel(day)}, ${timeOf(p.at)}`;
  $('phViewer').hidden = false;
  paintNav();
}

/** Move the viewer to the photo before (-1) or after (+1) the one on screen. */
function step(dir: number): void {
  if (!shown) return;
  const list = inOrder();
  const i = list.findIndex(x => x.p.id === shown!.id);
  const next = i < 0 ? undefined : list[i + dir];
  if (next) open(next.p, next.day, dir);
}

/** The previous / next buttons: faded at either end of the library. */
function paintNav(): void {
  const list = inOrder();
  const i = shown ? list.findIndex(x => x.p.id === shown!.id) : -1;
  $('phPos').textContent = i >= 0 ? `${i + 1} of ${list.length}` : '';
  $<HTMLButtonElement>('phPrev').disabled = i <= 0;
  $<HTMLButtonElement>('phNext').disabled = i < 0 || i >= list.length - 1;
}

function close(): void {
  shown = null;
  resetZoom(true);
  $('phViewer').hidden = true;
  paintMissing(false);
  $<HTMLImageElement>('phFull').removeAttribute('src');
}

/** A picture that cannot load: the stage shows a note in place of it, Ask Claude is off, and Delete stays on. */
function paintMissing(missing: boolean): void {
  $<HTMLImageElement>('phFull').hidden = missing;
  $('phMissing').hidden = !missing;
  $<HTMLButtonElement>('phAsk').disabled = missing;
}

/** The full picture failed to load. Ignore an error from an earlier photo that the viewer has moved on from. */
function onFullError(): void {
  const img = $<HTMLImageElement>('phFull');
  if (!shown || img.getAttribute('src') !== shown.url) return;
  $('phMissing').textContent = 'This photo can’t be shown. It may have been deleted on the PC.';
  paintMissing(true);
}

// ---------- the viewer's zoom: pinch or double-tap to zoom, drag to move, a sideways swipe to go on ----------
/** Put the picture at the zoom it is in, with its edges kept inside the stage. `instant` skips the glide. */
function paintZoom(instant: boolean): void {
  const img = $<HTMLImageElement>('phFull'), stage = $('phStage');
  const mx = Math.max(0, (img.offsetWidth * zoom.s - stage.clientWidth) / 2);
  const my = Math.max(0, (img.offsetHeight * zoom.s - stage.clientHeight) / 2);
  zoom.x = Math.min(mx, Math.max(-mx, zoom.x));
  zoom.y = Math.min(my, Math.max(-my, zoom.y));
  img.classList.toggle('instant', instant);
  img.style.transform = zoom.s > 1 ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})` : '';
}

function resetZoom(instant: boolean): void {
  zoom.s = 1; zoom.x = 0; zoom.y = 0;
  paintZoom(instant);
}

/** Zoom to `s`, keeping the point (x, y) on screen where it is. */
function zoomAt(x: number, y: number, s: number, instant: boolean): void {
  const next = Math.min(MAX_ZOOM, Math.max(1, s));
  if (next <= 1) { resetZoom(instant); return; }
  const r = $('phStage').getBoundingClientRect();
  const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
  const k = next / zoom.s;
  zoom.x = dx * (1 - k) + k * zoom.x;
  zoom.y = dy * (1 - k) + k * zoom.y;
  zoom.s = next;
  paintZoom(instant);
}

function toggleZoomAt(x: number, y: number): void {
  if (zoom.s > 1) resetZoom(false); else zoomAt(x, y, 2.5, false);
}

function pinchSpan(): number {
  const [a, b] = [...touches.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}

function onStageDown(e: PointerEvent): void {
  if ((e.target as Element).closest('button')) return;   // the arrows and Back are not the picture
  touches.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
  $('phStage').setPointerCapture(e.pointerId);
  if (touches.size === 1) { moved = false; swipeAt = { x: e.clientX, y: e.clientY }; }
  else { moved = true; swipeAt = null; pinchD = pinchSpan(); }
}

function onStageMove(e: PointerEvent): void {
  const t = touches.get(e.pointerId);
  if (!t) return;
  const px = t.x, py = t.y;
  t.x = e.clientX; t.y = e.clientY;
  if (Math.hypot(t.x - t.x0, t.y - t.y0) > 10) moved = true;
  if (touches.size >= 2) {
    const d = pinchSpan();
    if (pinchD > 0 && d > 0) {
      const [a, b] = [...touches.values()];
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, zoom.s * d / pinchD, true);
    }
    pinchD = d;
  } else if (zoom.s > 1) {
    zoom.x += t.x - px; zoom.y += t.y - py;
    paintZoom(true);
  }
}

function onStageUp(e: PointerEvent): void {
  const t = touches.get(e.pointerId);
  if (!t) return;
  touches.delete(e.pointerId);
  if (touches.size > 0) return;   // a finger is still down: the pinch or the drag carries on
  $('phFull').classList.remove('instant');
  const wasTap = !moved;
  if (wasTap) {
    // a tap, and a second one close by soon after, toggles the zoom
    swipeAt = null;
    const now = Date.now();
    if (now - lastTap.t < 320 && Math.hypot(t.x - lastTap.x, t.y - lastTap.y) < 40) { lastTap = { t: 0, x: 0, y: 0 }; toggleZoomAt(t.x, t.y); }
    else lastTap = { t: now, x: t.x, y: t.y };
    return;
  }
  if (swipeAt && zoom.s === 1) {
    const dx = t.x - swipeAt.x, dy = t.y - swipeAt.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
  }
  swipeAt = null;
}

function onStageCancel(): void {
  touches.clear();
  swipeAt = null;
  moved = false;
  $('phFull').classList.remove('instant');
}

// ---------- the ClaudeOS sheet: "Delete this photo? This can't be undone." ----------
function askDelete(ids: string[]): void {
  if (!ids.length) return;
  pending = ids;
  $('phSheetTitle').textContent = ids.length === 1 ? 'Delete this photo?' : `Delete ${ids.length} photos?`;
  $('phSheetErr').hidden = true;
  $<HTMLButtonElement>('phGone').disabled = false;
  $<HTMLButtonElement>('phKeep').disabled = false;
  $('phSheet').hidden = false;
}
function hideSheet(): void {
  pending = [];
  $('phSheet').hidden = true;
}

/** Delete the photos the sheet asked about. Only what the PC reports as gone leaves the grid. */
async function removePending(): Promise<void> {
  const ids = pending;
  if (!ids.length) return;
  $<HTMLButtonElement>('phGone').disabled = true;
  $<HTMLButtonElement>('phKeep').disabled = true;
  report(ids.length === 1 ? 'photos:delete' : 'photos:delete:many');
  // the PC takes at most DELETE_BATCH ids a request (server/index.ts): send them in batches and keep what each one removed
  const gone = new Set<string>();
  let refused = false;
  for (const batch of deleteBatches(ids)) {
    let r: PhotoDeleteResult | null = null;
    try { r = await postJson<PhotoDeleteResult>('/api/photos/delete', batch.length === 1 ? { id: batch[0] } : { ids: batch }); }
    catch { r = null; }
    if (!r || (!r.ok && !r.deleted && !r.missing)) { refused = true; break; }
    for (const id of [...(r.deleted || []), ...(r.missing || [])]) gone.add(id);
  }
  if (refused && !gone.size) {
    // the PC did not answer, or refused the first request: nothing was removed, so say so and let the person try again
    $('phSheetErr').textContent = 'Couldn’t delete. Try again when the PC answers.';
    $('phSheetErr').hidden = false;
    $<HTMLButtonElement>('phGone').disabled = false;
    $<HTMLButtonElement>('phKeep').disabled = false;
    return;
  }
  hideSheet();
  days = days.map(d => ({ ...d, photos: d.photos.filter(p => !gone.has(p.id)) })).filter(d => d.photos.length);
  for (const id of gone) picked.delete(id);
  if (shown && gone.has(shown.id)) close();
  setSelecting(false);
  paint();
  await load();   // the PC's own list, now
  const failed = ids.length - gone.size;   // could not be removed, or not reached after a refused batch
  if (failed) {
    $('phNote').hidden = false;
    $('phNote').textContent = failed === 1 ? 'One photo couldn’t be deleted. Try again.' : `${failed} photos couldn’t be deleted. Try again.`;
  }
}

/** Ask Claude about the picked photos: up to three go with one message, in the order the grid shows them. */
function askPicked(): void {
  const ids = inOrder().map(x => x.p.id).filter(id => picked.has(id));
  if (!ids.length || ids.length > ASK_MAX_PHOTOS) return;
  report('photos:ask:many');
  for (const id of ids) askWithPhoto(id);
  setSelecting(false);
  openApp('claude');
}

// ---------- the grid: tap to open, long-press to pick ----------
function cancelPress(): void {
  clearTimeout(pressTimer);
  pressTimer = undefined;
}

function onPressStart(e: PointerEvent): void {
  suppressClick = false;
  const cell = (e.target as Element).closest<HTMLElement>('[data-id]');
  if (!cell || !e.isPrimary) return;
  pressAt = { x: e.clientX, y: e.clientY };
  cancelPress();
  pressTimer = window.setTimeout(() => {
    pressTimer = undefined;
    suppressClick = true;
    report('photos:select');
    if (!selecting) selecting = true;
    togglePick(cell.dataset.id!);
  }, 480);
}

function onPressMove(e: PointerEvent): void {
  if (pressTimer !== undefined && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 10) cancelPress();
}

const app: HubApp = {
  id: manifest.id,
  name: 'Photos',
  icon: ICON,
  mount(c) {
    ctx = c;
    const grid = $('phDays');
    grid.addEventListener('click', e => {
      if (suppressClick) { suppressClick = false; return; }
      const head = (e.target as Element).closest<HTMLElement>('.ph-dayhd');
      if (head && selecting) {
        const ids = groupIds[Number(head.dataset.group)];
        if (ids) { report('photos:select:day'); const next = toggleDay(picked, ids); picked.clear(); for (const id of next) picked.add(id); paint(); }
        return;
      }
      const cell = (e.target as Element).closest<HTMLElement>('[data-id]');
      if (!cell) return;
      const id = cell.dataset.id!;
      if (selecting) { report('photos:pick'); togglePick(id); return; }
      for (const d of days) {
        const p = d.photos.find(x => x.id === id);
        if (p) { report('photos:open'); open(p, d.day); return; }
      }
    });
    grid.addEventListener('pointerdown', onPressStart);
    grid.addEventListener('pointermove', onPressMove);
    grid.addEventListener('pointerup', cancelPress);
    grid.addEventListener('pointercancel', cancelPress);
    grid.addEventListener('pointerleave', cancelPress);
    grid.addEventListener('contextmenu', e => e.preventDefault());   // a long-press is not a context menu
    // a picture that has loaded fades in once; the card behind it is the placeholder until then
    grid.addEventListener('load', e => {
      const img = e.target;
      if (img instanceof HTMLImageElement) { loaded.add(img.getAttribute('src') || ''); img.classList.add('in'); }
    }, true);
    $('phSelect').addEventListener('click', () => { report('photos:select:bar'); setSelecting(true); });
    $('phOpenCam').addEventListener('click', () => { report('photos:camera'); openApp('camera'); });

    $('phBack').addEventListener('click', close);
    $('phPrev').addEventListener('click', () => step(-1));
    $('phNext').addEventListener('click', () => step(1));
    // pinch or double-tap to zoom; a sideways swipe on the picture goes to the next (left) or the one before (right)
    const stage = $('phStage');
    stage.addEventListener('pointerdown', onStageDown);
    stage.addEventListener('pointermove', onStageMove);
    stage.addEventListener('pointerup', onStageUp);
    stage.addEventListener('pointercancel', onStageCancel);
    $<HTMLImageElement>('phFull').addEventListener('error', onFullError);
    $('phDel').addEventListener('click', () => { if (shown) askDelete([shown.id]); });
    $('phAsk').addEventListener('click', () => {
      if (!shown) return;
      report('photos:ask');
      askWithPhoto(shown.id);
      close();
      openApp('claude');
    });
    $('phSelAll').addEventListener('click', selectAll);
    $('phSelAsk').addEventListener('click', askPicked);
    $('phSelCancel').addEventListener('click', () => setSelecting(false));
    $('phSelDel').addEventListener('click', () => { if (picked.size) askDelete([...picked]); });
    $('phKeep').addEventListener('click', hideSheet);
    $('phGone').addEventListener('click', () => { void removePending(); });
    $('phSheet').addEventListener('click', e => { if (e.target === $('phSheet')) hideSheet(); });
    // Back (system.ts): the delete sheet closes first, then the viewer, then select mode; then Home
    onBack(() => {
      if (!ctx.isVisible()) return false;
      if (!$('phSheet').hidden) { hideSheet(); return true; }
      if (shown) { close(); return true; }
      if (selecting) { setSelecting(false); return true; }
      return false;
    }, 10);
    backfillActive(ctx.isVisible());
    void load();
  },
  onShow() { backfillActive(true); void load(); },
  onHide() { backfillActive(false); close(); hideSheet(); setSelecting(false); },
  onClose() { backfillActive(false); close(); hideSheet(); setSelecting(false); },
};
export default app;
