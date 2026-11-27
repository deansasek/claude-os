// Photo thumbnails in the browser. A thumbnail is a small JPEG drawn from the full picture with a canvas, and kept on the
// PC beside the photo (<id>_thumb.jpg), so the grids download a few KB instead of up to 8 MB. Photos that have no
// thumbnail yet get one made here, once: the Photos grid asks backfillThumb(), two at a time, and only while Photos is
// on screen (backfillActive). The full picture stays the source for the viewer and for Claude.
import { THUMB_MAX_BYTES, THUMB_PX } from '../api.ts';

/** A JPEG of at most THUMB_PX on its long side, from any picture the browser can draw. Null if it can't be made. */
async function makeThumb(full: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(full);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return null;
    const k = Math.min(1, THUMB_PX / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    const g = c.getContext('2d');
    if (!g) return null;
    g.drawImage(img, 0, 0, c.width, c.height);
    // quality 0.8 is the target; a picture that still comes out too big is redone a little lower
    for (const q of [0.8, 0.6]) {
      const out = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', q));
      if (out && out.size <= THUMB_MAX_BYTES) return out;
    }
    return null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Longest wait for one read or one send. A PC that never answers must not hold a backfill slot for good. */
export const THUMB_FETCH_MS = 20e3;

/** Make a photo's thumbnail from its full picture and keep it on the PC. True when the PC kept it. */
async function sendThumb(id: string, full: Blob): Promise<boolean> {
  const thumb = await makeThumb(full);
  if (!thumb) return false;
  try {
    const r = await fetch(`/api/photos/thumb?id=${encodeURIComponent(id)}`, {
      method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: thumb,
      signal: AbortSignal.timeout(THUMB_FETCH_MS),
    });
    const j = await r.json() as { ok?: boolean };
    return r.ok && j.ok === true;
  } catch {
    return false;   // the PC is away, or refused the picture (a non-JSON answer lands here too)
  }
}

// ---------- the backfill: photos with no thumbnail yet, two at a time, while Photos is on screen ----------
const MAX_AT_ONCE = 2;
interface Job { url: string; running: boolean; subs: ((ok: boolean) => void)[] }
const jobs = new Map<string, Job>();   // by photo id, in the order they were asked (the grid's order)
let active = false;

/** Photos is on screen (true) or not (false). Jobs wait while it is not; a job already running finishes. */
export function backfillActive(on: boolean): void {
  active = on;
  pump();
}

/** Make a thumbnail for a photo the PC has none for. Resolves true once the PC keeps it, false if it can't. */
export function backfillThumb(id: string, fullUrl: string): Promise<boolean> {
  return new Promise(resolve => {
    const job = jobs.get(id);
    if (job) { job.subs.push(resolve); return; }
    jobs.set(id, { url: fullUrl, running: false, subs: [resolve] });
    pump();
  });
}

function pump(): void {
  if (!active) return;
  let running = 0;
  for (const j of jobs.values()) if (j.running) running++;
  for (const [id, j] of jobs) {
    if (running >= MAX_AT_ONCE) break;
    if (j.running) continue;
    j.running = true;
    running++;
    void run(id, j);
  }
}

async function run(id: string, job: Job): Promise<void> {
  let ok = false;
  try {
    const full = await fetch(job.url, { signal: AbortSignal.timeout(THUMB_FETCH_MS) })
      .then(r => (r.ok ? r.blob() : null));
    ok = !!full && await sendThumb(id, full);
  } catch {
    ok = false;
  }
  jobs.delete(id);
  for (const s of job.subs) s(ok);
  pump();
}
