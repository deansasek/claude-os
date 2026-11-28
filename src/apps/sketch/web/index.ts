// The Sketch app: draw with a finger or a stylus. The pen and the clay pen draw ink; the eraser paints over in the
// card colour. Undo takes the last stroke back, Clear empties the page, and Save sends the drawing to Photos.
// The strokes are data (strokes.ts); draw.ts paints them and save.ts sends them. This file reads the pointer.
import { appIcon } from '../../../core/web/app-icons.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { manifest } from '../manifest.ts';
import { drawBoard } from './draw.ts';
import { exportJpeg, savePhoto } from './save.ts';
import { EMPTY, begin, extend, hasInk, undo, type Board, type Pt, type Tool } from './strokes.ts';

let canvas: HTMLCanvasElement | null = null;
let g: CanvasRenderingContext2D | null = null;
let board: Board = EMPTY;
let tool: Tool = 'ink';
let pointer: number | null = null;   // the finger (or pen) drawing the stroke; other pointers are ignored
let saving = false;

/** Size the drawing surface to its box, sharp on high-density screens. */
function fit(): void {
  if (!canvas || !g) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  redraw();
}

function redraw(): void {
  if (!canvas || !g) return;
  drawBoard(g, board, canvas.clientWidth, canvas.clientHeight);
}

// the theme can change while Sketch is on screen (the time mode, "dark mode", the logo): repaint the board in its colours
new MutationObserver(() => redraw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

function at(e: PointerEvent): Pt {
  const r = (canvas as HTMLCanvasElement).getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function paintTools(c: AppContext): void {
  c.$('skBar').querySelectorAll<HTMLElement>('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
}

/** Send the drawing to Photos. One save runs at a time; the status line says how it went. */
async function save(c: AppContext): Promise<void> {
  if (saving || !canvas) return;
  const status = c.$('skStatus');
  // nothing drawn: a blank card must not reach the family's Photos
  if (!hasInk(board)) { status.textContent = 'Nothing to save yet'; return; }
  saving = true;
  status.textContent = 'Saving…';
  const blob = await exportJpeg(board, canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio || 1);
  const ok = blob ? await savePhoto(blob) : false;
  status.textContent = ok ? 'Saved to Photos' : 'Could not save';
  saving = false;
}

const app: HubApp = {
  ...manifest,
  icon: appIcon('sketch'),
  mount(c: AppContext) {
    canvas = c.$<HTMLCanvasElement>('skCanvas');
    g = canvas.getContext('2d');
    canvas.addEventListener('pointerdown', e => {
      if (pointer !== null) return;   // a second finger or a resting palm does not start or join a stroke
      pointer = e.pointerId;
      canvas?.setPointerCapture(e.pointerId);
      board = begin(board, tool, at(e));
      redraw();
    });
    canvas.addEventListener('pointermove', e => {
      if (pointer !== e.pointerId) return;
      board = extend(board, at(e));
      redraw();
    });
    const stop = (e: PointerEvent): void => { if (pointer === e.pointerId) pointer = null; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    c.$('skBar').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.tool) { tool = b.dataset.tool as Tool; paintTools(c); return; }
      if (b.dataset.act === 'save') { void save(c); return; }
      if (b.dataset.act === 'undo') board = undo(board);
      if (b.dataset.act === 'clear') { board = EMPTY; c.$('skStatus').textContent = ''; }
      redraw();
    });
    paintTools(c);
    fit();
  },
  // shown again: the surface may have changed size while it was hidden
  onShow() { fit(); },
};
export default app;
