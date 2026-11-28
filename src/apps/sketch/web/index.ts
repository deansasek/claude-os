// The Sketch app: draw with a finger or a stylus. The pen and the clay pen draw ink; the eraser paints over in the
// card colour. Undo takes the last stroke back, Clear empties the page. The strokes are data (strokes.ts); this file
// only draws them and reads the pointer. Colours come from the page's tokens, so the page still matches the theme.
import { appIcon } from '../../../core/web/app-icons.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { manifest } from '../manifest.ts';
import { EMPTY, begin, extend, undo, type Board, type Pt, type Tool } from './strokes.ts';

const WIDTH: Record<Tool, number> = { ink: 3, clay: 6, erase: 26 };
const TOKEN: Record<Tool, string> = { ink: '--text', clay: '--clay', erase: '--card' };

let canvas: HTMLCanvasElement | null = null;
let g: CanvasRenderingContext2D | null = null;
let board: Board = EMPTY;
let tool: Tool = 'ink';
let drawing = false;

const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Size the drawing surface to its box, sharp on high-density screens. */
function fit(): void {
  if (!canvas || !g) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  redraw();
}

/** Paint the page, then every stroke in order. */
function redraw(): void {
  if (!canvas || !g) return;
  g.fillStyle = token('--card');
  g.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
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

function at(e: PointerEvent): Pt {
  const r = (canvas as HTMLCanvasElement).getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function paintTools(c: AppContext): void {
  c.$('skBar').querySelectorAll<HTMLElement>('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
}

const app: HubApp = {
  ...manifest,
  icon: appIcon('sketch'),
  mount(c: AppContext) {
    canvas = c.$<HTMLCanvasElement>('skCanvas');
    g = canvas.getContext('2d');
    canvas.addEventListener('pointerdown', e => {
      canvas?.setPointerCapture(e.pointerId);
      drawing = true;
      board = begin(board, tool, at(e));
      redraw();
    });
    canvas.addEventListener('pointermove', e => {
      if (!drawing) return;
      board = extend(board, at(e));
      redraw();
    });
    const stop = (): void => { drawing = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    c.$('skBar').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.tool) { tool = b.dataset.tool as Tool; paintTools(c); return; }
      if (b.dataset.act === 'undo') board = undo(board);
      if (b.dataset.act === 'clear') board = EMPTY;
      redraw();
    });
    paintTools(c);
    fit();
  },
  // shown again: the surface may have changed size while it was hidden
  onShow() { fit(); },
};
export default app;
