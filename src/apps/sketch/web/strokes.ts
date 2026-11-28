// The Sketch drawing as data, with no DOM: a board is a list of strokes, and each stroke is a tool and its points.
// Every change returns a new board, so the page can redraw from any earlier one.
export interface Pt { x: number; y: number }
export type Tool = 'ink' | 'clay' | 'erase';
export interface Stroke { tool: Tool; pts: Pt[] }
export type Board = readonly Stroke[];

export const EMPTY: Board = [];

/** A pen goes down: a new stroke starts at p. */
export const begin = (b: Board, tool: Tool, p: Pt): Board => [...b, { tool, pts: [p] }];

/** The pen moves: the newest stroke gets p. A move with no stroke started does nothing. */
export function extend(b: Board, p: Pt): Board {
  if (!b.length) return b;
  const last = b[b.length - 1];
  return [...b.slice(0, -1), { ...last, pts: [...last.pts, p] }];
}

/** Undo: the newest stroke goes. */
export const undo = (b: Board): Board => b.slice(0, -1);
