// The Camera app: a live preview (the tablet draws it under the page), a shutter, front and back, the last
// photo (opens Photos), and "Ask Claude about this" after each shot. Look (look.ts) is the full-screen mode.
import { getJson, report } from '../../../core/web/dom.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { onBack, openApp } from '../../../core/web/system.ts';
import { askWithPhoto } from '../../claude/web/reply.ts';
import { thumbUrl } from '../../photos/api.ts';
import type { PhotoList } from '../../photos/api.ts';
import { manifest } from '../manifest.ts';
import * as cam from './camera.ts';
import { enterLook, exitLook, initLook, isLooking } from './look.ts';

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);
let shotId: string | null = null;
let flashTimer: number | undefined;

const ICON = appIcon('camera');

/** The preview's state, shown in the header pill and (when it isn't on) over the frame. */
function paintState(state: cam.CamState, message?: string): void {
  const pill = $('caPill'), text = $('caPillText'), msg = $('caMsg'), msgText = $('caMsgText');
  const on = state === 'open';
  document.documentElement.classList.toggle('cam-live', on);   // the page is see-through where the preview is
  pill.className = 'live';
  if (state === 'open') { pill.classList.add('ok'); text.textContent = 'Ready'; }
  else if (state === 'asking') { pill.classList.add('wait'); text.textContent = 'Starting…'; }
  else if (state === 'error') { pill.classList.add('bad'); text.textContent = 'Unavailable'; }
  else text.textContent = 'Off';
  msg.hidden = on;
  msgText.textContent = state === 'asking' ? 'Starting the camera…'
    : state === 'error' ? (message || cam.camError('failed'))
    : state === 'closed' ? 'The camera is off. Leave Camera and come back to turn it on.'
    : 'Starting the camera…';
}

function flash(): void {
  const f = $('caFlash');
  f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => f.classList.remove('on'), 320);
}

let shooting = false;   // one photo at a time: a second tap while it uploads does nothing

async function shoot(): Promise<void> {
  if (!cam.cameraAvailable || shooting) return;
  if (!cam.isOpen()) { $('caMsgText').textContent = 'The camera is still starting.'; $('caMsg').hidden = false; return; }
  shooting = true;
  try {
    report('camera:shot');
    flash();
    const s = await cam.takePhoto();
    if (!s.ok) { $('caMsgText').textContent = cam.camError(s.code); $('caMsg').hidden = false; return; }
    showShot(s.id, s.url);
    void refreshLast();
  } finally { shooting = false; }
}

function showShot(id: string, url: string): void {
  shotId = id;
  $<HTMLImageElement>('caShot').src = url;
  $('caAfter').hidden = false;
}
function hideShot(): void {
  shotId = null;
  $('caAfter').hidden = true;
}

/** The caption under the flip button names the camera in use now; the button's name says where it will switch to. */
function paintFacing(): void {
  const now = cam.facingNow();
  $('caFacing').textContent = now === 'back' ? 'Back camera' : 'Front camera';
  $('caFlip').setAttribute('aria-label', now === 'back' ? 'Switch to the front camera' : 'Switch to the back camera');
}

/** The thumbnail of the newest photo (empty until there is one). */
async function refreshLast(): Promise<void> {
  try {
    const l = await getJson<PhotoList>('/api/photos/list?limit=1');
    const p = l.days[0]?.photos[0];
    const img = $<HTMLImageElement>('caLastImg');
    // the thumbnail, as Photos' grid does; a photo with no thumb yet (the native one is still uploading, or the web
    // backfill hasn't reached it) shows the full picture, so the button is never blank
    const src = p ? (p.hasThumb ? thumbUrl(p.id) : p.url) : '';
    if (p && img.getAttribute('src') !== src) img.src = src;
    $('caLastBtn').classList.toggle('empty', !p);
  } catch { /* the PC is busy or away: keep what we have */ }
}

const app: HubApp = {
  id: manifest.id,
  name: 'Camera',
  icon: ICON,
  mount(c) {
    ctx = c;
    initLook({
      frame: $('caFrame'), view: $('lkView'), overlay: $('lkMode'), main: $('caMain'),
      state: $('lkState'), answer: $('lkAnswer'), end: $('lkEnd'),
      heard: $('lkHeard'), seen: $('lkSeen'), seenImg: $<HTMLImageElement>('lkSeenImg'),
    }, on => document.documentElement.classList.toggle('look-live', on));
    cam.onState(paintState);
    paintFacing();
    $('caShutter').addEventListener('click', () => { void shoot(); });
    $('caFlip').addEventListener('click', () => { report('camera:flip'); cam.flip(); paintFacing(); });
    $('caLook').addEventListener('click', () => { report('camera:look'); enterLook(); });
    $('caAsk').addEventListener('click', () => {
      if (!shotId) return;
      report('camera:ask');
      askWithPhoto(shotId);
      hideShot();
      openApp('claude');
    });
    $('caDismiss').addEventListener('click', hideShot);
    // Back (system.ts): the photo just taken closes first (as "Take another" does), then Look ends; then Home
    onBack(() => {
      if (!ctx.isVisible()) return false;
      if (!$('caAfter').hidden) { hideShot(); return true; }
      if (isLooking()) { exitLook(); return true; }
      return false;
    }, 10);
    $('caLastBtn').addEventListener('click', () => { report('camera:photos'); openApp('photos'); });
    if (!cam.cameraAvailable) {
      paintState('error', 'Camera needs the ClaudeOS tablet app.');
      $('caPillText').textContent = 'Tablet only';
      $('caMsgText').textContent = 'The camera works on the ClaudeOS tablet. Open Camera there.';
      for (const b of ['caShutter', 'caFlip', 'caLook']) ($(b) as HTMLButtonElement).disabled = true;
    }
    void refreshLast();
  },
  onShow() {
    void refreshLast();
    // after the page has finished sliding in, so the preview lands on the frame
    setTimeout(() => { if (!isLooking()) cam.show($('caFrame')); }, 320);
  },
  onHide() { exitLook(); cam.hide(); document.documentElement.classList.remove('cam-live'); },
  onClose() { exitLook(); cam.hide(); document.documentElement.classList.remove('cam-live'); },
};
export default app;
