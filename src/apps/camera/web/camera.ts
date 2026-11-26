// The tablet's camera for the Camera app: the native preview (drawn under the page, over the box the page
// gives), and photos. A photo is taken with takePhoto(): the tablet uploads it to the PC and the answer
// (its id and address) comes back here. The camera is open only while a screen wants it (show / hide).
import { camera, onResume, screenRect } from '../../../core/web/device.ts';
import { prefs, quietNow } from '../../../core/web/system.ts';

type Facing = 'back' | 'front';
/** A short code for a camera failure: busy (another app has it), no_camera (not on this side), denied (not allowed), failed. */
type CamCode = 'busy' | 'no_camera' | 'denied' | 'failed';
type Shot = { ok: true; id: string; url: string } | { ok: false; code: CamCode; message?: string };
export type CamState = 'open' | 'asking' | 'closed' | 'error';

const CODES: readonly CamCode[] = ['busy', 'no_camera', 'denied', 'failed'];
/** What the person reads for each code. */
const COPY: Record<CamCode, string> = {
  busy: 'The camera is busy. Close anything else that uses it, then come back.',
  no_camera: 'This tablet has no camera on that side. Switch cameras.',
  denied: 'ClaudeOS isn’t allowed to use the camera. Turn the camera on for ClaudeOS, then come back.',
  failed: 'The camera didn’t work. Try again in a moment.',
};

/** Any code the tablet sends, as one of the four (anything else is failed). */
const camCode = (c?: string): CamCode => (CODES as readonly string[]).includes(c || '') ? c as CamCode : 'failed';
/** The words for a failure: the copy, then the short code in brackets, so the person and a support call agree. */
export const camError = (code?: string): string => { const k = camCode(code); return `${COPY[k]} (${k})`; };

let facing: Facing = 'back';
let target: HTMLElement | null = null;   // where the preview sits: the frame, or Look's full-screen view
let isOn = false;                        // the native preview is up
let wanted = false;                      // a screen wants the camera (reopened after Android paused it)
const waiters = new Map<string, (s: Shot) => void>();
const listeners: ((state: CamState, message?: string) => void)[] = [];
const emit = (state: CamState, message?: string) => listeners.forEach(f => { try { f(state, message); } catch (e) { console.error(e); } });

/** The browser's own camera (Safari on the iPad, over HTTPS): used when the tablet's native camera is not there. */
const webCamOk = (): boolean => typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
export const cameraAvailable = camera.available || webCamOk();
/** True when the tablet's own camera draws the picture under the page (the page goes see-through then). */
export const nativeCamera = camera.available;
let stream: MediaStream | null = null;   // the browser's camera stream, while it is on
const videoEl = (): HTMLVideoElement | null => document.getElementById('caVideo') as HTMLVideoElement | null;
/** Turn the browser's camera off and hide its picture. */
function stopWeb(): void {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  const v = videoEl();
  if (v) { v.srcObject = null; v.hidden = true; }
}
/** The browser's camera failure name, as a short code (busy, denied, no_camera or failed). */
const webCode = (name: string): CamCode =>
  name === 'NotAllowedError' || name === 'SecurityError' ? 'denied'
    : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'no_camera'
    : name === 'NotReadableError' ? 'busy' : 'failed';
/** Open the browser's camera in the frame. */
async function openWeb(): Promise<void> {
  if (stream) return;
  const v = videoEl();
  if (!v) { emit('error', camError('failed')); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing === 'front' ? 'user' : 'environment' }, audio: false });
  } catch (e) {
    emit('error', camError(webCode((e as DOMException).name)));
    return;
  }
  if (!wanted) { stopWeb(); return; }   // the screen left while the browser was asking
  v.srcObject = stream;
  v.hidden = false;
  try { await v.play(); } catch { /* Safari starts the picture once the frame arrives */ }
  isOn = true;
  emit('open');
}
/** A photo from the browser's camera: a JPEG of the current frame, uploaded to the PC like a native photo. */
async function captureWeb(id: string): Promise<Shot> {
  const v = videoEl();
  if (!stream || !v || !isOn || !v.videoWidth) return { ok: false, code: 'failed' };
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const g = c.getContext('2d');
  if (!g) return { ok: false, code: 'failed' };
  if (facing === 'front') { g.translate(c.width, 0); g.scale(-1, 1); }   // the selfie is mirrored, as on the screen
  g.drawImage(v, 0, 0);
  const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.9));
  if (!blob) return { ok: false, code: 'failed' };
  try {
    const r = await fetch('/api/photos/upload', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-Photo-Id': id }, body: blob });
    const j = await r.json() as { ok?: boolean; url?: string };
    return j.ok && j.url ? { ok: true, id, url: j.url } : { ok: false, code: 'failed' };
  } catch {
    return { ok: false, code: 'failed' };
  }
}
export const isOpen = (): boolean => isOn;
export const facingNow = (): Facing => facing;
export function onState(fn: (state: CamState, message?: string) => void): void { listeners.push(fn); }

camera.on(e => {
  switch (e.type) {
    case 'opened':
      // The open was still pending when the screen closed (hide cleared wanted): close it now, do not show it.
      if (!wanted) { camera.close(); isOn = false; break; }
      isOn = true; emit('open'); break;
    case 'closed': isOn = false; emit('closed', e.reason); break;   // 'paused': Android took the camera; onResume reopens it
    case 'captured': {
      const w = waiters.get(e.id); waiters.delete(e.id);
      w?.({ ok: true, id: e.id, url: e.url });
      break;
    }
    case 'error': {
      // a photo that did not reach the PC leaves the preview open: the next shutter tap still works
      if (!e.id) isOn = false;
      if (e.id) { const w = waiters.get(e.id); waiters.delete(e.id); w?.({ ok: false, code: camCode(e.code), message: e.message }); }
      else emit('error', camError(e.code));
      break;
    }
  }
});

// Android paused the camera (ClaudeOS went to the background): when we're back and still wanted, reopen it.
onResume(() => { if (wanted && target && !isOn) show(target); });

/** Open the preview over `el` (or move it there if it's open already). */
export function show(el: HTMLElement): void {
  target = el; wanted = true;
  if (!cameraAvailable) { emit('error', 'Camera needs the ClaudeOS tablet app.'); return; }
  if (!camera.available) { void openWeb(); return; }   // the browser's camera, in the frame
  if (isOn) { camera.move(screenRect(el)); return; }
  const r = camera.open(facing, screenRect(el));
  if (r.asking) { emit('asking'); return; }   // only if the grant was not re-applied: Android's prompt is the last resort
  if (!r.ok) emit('error', camError(r.error === 'not allowed' ? 'denied' : 'failed'));
}

/** Follow a screen that moved (the frame, or Look's full-screen view). */
export function moveTo(el: HTMLElement): void {
  target = el;
  if (isOn && camera.available) camera.move(screenRect(el));   // the browser's picture stays in its frame
}

/** Close the preview: a screen has gone away. */
export function hide(): void {
  wanted = false; target = null;
  if (camera.available && isOn) camera.close();
  stopWeb();
  isOn = false;
}

/** Front and back: close, then open the other one once Android has let go of the first. */
export function flip(): void {
  facing = facing === 'back' ? 'front' : 'back';
  if (!isOn) return;
  const el = target;
  if (camera.available) camera.close(); else stopWeb();
  isOn = false;
  if (el) setTimeout(() => { if (wanted && target === el) show(el); }, 450);
}

/** A new id for a photo: short, and only the characters the server accepts. */
const newPhotoId = (): string => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;

/** Take a photo and wait for it to reach the PC. The shutter click plays only when chimes are on and it is not Do Not Disturb or quiet hours. */
export function takePhoto(): Promise<Shot> {
  if (!cameraAvailable) return Promise.resolve({ ok: false, code: 'no_camera' });
  if (!camera.available) return captureWeb(newPhotoId());
  if (!isOn) return Promise.resolve({ ok: false, code: 'failed' });
  const id = newPhotoId();
  const sound = prefs.chimes && !prefs.dnd && !quietNow();
  return new Promise<Shot>(resolve => {
    const timer = window.setTimeout(() => { waiters.delete(id); resolve({ ok: false, code: 'failed' }); }, 20e3);
    waiters.set(id, s => { clearTimeout(timer); resolve(s); });
    const r = camera.capture(id, sound);
    if (!r.ok) { clearTimeout(timer); waiters.delete(id); resolve({ ok: false, code: r.error === 'busy' ? 'busy' : 'failed' }); }
  });
}
