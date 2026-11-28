// A game's scores, with no DOM: each change is kept so Undo can take it back. The game is saved on the device as JSON.
export interface Game {
  players: number[];    // one score per player
  history: number[][];  // the scores before each change, newest last (undo pops the last)
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
const KEEP = 50;   // how many changes Undo can take back

/** A new game with n players, all at zero (n is clamped to 2 to 6). */
export function newGame(n: number): Game {
  const count = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.floor(n)));
  return { players: Array<number>(count).fill(0), history: [] };
}

/** Add delta to one player's score. A player that is not in the game changes nothing. */
export function change(g: Game, i: number, delta: number): Game {
  if (!Number.isInteger(i) || i < 0 || i >= g.players.length) return g;
  const players = g.players.map((v, j) => (j === i ? v + delta : v));
  return { players, history: [...g.history, g.players].slice(-KEEP) };
}

/** Take back the last change. */
export function undo(g: Game): Game {
  if (!g.history.length) return g;
  return { players: g.history[g.history.length - 1], history: g.history.slice(0, -1) };
}

/** The players in the lead: those with the top score, when that score is above zero. */
export function leaders(g: Game): number[] {
  const top = Math.max(0, ...g.players);
  return top > 0 ? g.players.flatMap((v, i) => (v === top ? [i] : [])) : [];
}

/** A saved game, or null if the text is not one. */
export function parse(raw: string | null): Game | null {
  if (!raw) return null;
  try {
    const g = JSON.parse(raw) as Game;
    const ok = Array.isArray(g.players) && g.players.length >= MIN_PLAYERS && g.players.length <= MAX_PLAYERS
      && g.players.every(v => Number.isFinite(v)) && Array.isArray(g.history);
    return ok ? g : null;
  } catch {
    return null;
  }
}
