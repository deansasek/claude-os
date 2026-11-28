// Paint a Sketch board onto a 2D context: the page first (the card colour, so the eraser has something to paint over),
// then every stroke in order. The screen and the exported picture both use this, so they look the same.
import type { Board, Tool } from './strokes.ts';

export const WIDTH: Record<Tool, number> = { ink: 3, clay: 6, erase: 26 };
const TOKEN: Record<Tool, string> = { ink: '--text', clay: '--clay', erase: '--card' };

export const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Draw a board that is w by h CSS pixels. The context's transform must already map CSS pixels to device pixels. */
export function drawBoard(g: CanvasRenderingContext2D, board: Board, w: number, h: number): void {
  g.fillStyle = token('--card');
  g.fillRect(0, 0, w, h);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const s of board) {
    g.strokeStyle = g.fillStyle = token(TOKEN[s.tool]);
    g.lineWidth = WIDTH[s.tool];
    const [first, ...rest] = s.pts;
    if (!first) continue;
    if (!rest.length) { g.beginPath(); g.arc(first.x, first.y, WIDTH[s.tool] / 2, 0, Math.PI * 2); g.fill(); continue; }
    g.beginPath();
    g.moveTo(first.x, first.y);
    for (const p of rest) g.lineTo(p.x, p.y);
    g.stroke();
  }
}
