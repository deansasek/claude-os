// Save a Sketch drawing to Photos: the board is drawn into a JPEG and sent to the PC's photo upload, the same call the
// Camera app makes. The id starts with "sk", so a drawing is told apart from a camera photo. A PC that does not answer
// gives up after 20 s, so the Save button can be tried again.
import { drawBoard } from './draw.ts';
import type { Board } from './strokes.ts';

const UPLOAD_TIMEOUT_MS = 20e3;
const newDrawingId = (): string => `sk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;

/** The board as a JPEG, at the screen's density. */
export function exportJpeg(board: Board, w: number, h: number, dpr: number): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const g = c.getContext('2d');
  if (!g) return Promise.resolve(null);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBoard(g, board, w, h);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
}

/** Send the picture to Photos. True when the PC kept it. */
export async function savePhoto(blob: Blob): Promise<boolean> {
  try {
    const r = await fetch('/api/photos/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg', 'X-Photo-Id': newDrawingId() },
      body: blob,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    const j = await r.json() as { ok?: boolean };
    return j.ok === true;
  } catch {
    return false;
  }
}
