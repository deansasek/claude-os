// The control center's tile order (system.ts applies it; Settings → Appearance edits it). Pure: no DOM and no
// imports, so the test runs under node.

/** Every tile the tablet's control center can show, in the order it starts with. */
export const TILE_IDS = ['wifi', 'dnd', 'hey', 'low', 'theme', 'desk', 'timer', 'keep', 'clock', 'settings'] as const;

/** The name each tile shows in Settings. */
export const TILE_NAMES: Record<string, string> = {
  wifi: 'Wi-Fi', dnd: 'Do Not Disturb', hey: '“Hey Claude”', low: 'Low power', theme: 'Appearance', desk: 'Desk mode',
  timer: 'Timer', keep: 'Keep awake', clock: 'Clock', settings: 'Settings',
};

/**
 * The tile order to show: the saved order (a JSON array of tile ids, from the store) with unknown and repeated ids
 * dropped, then any tile the saved order does not name, in the default order. Anything that is not a list is the default.
 */
export function orderTiles(saved: string | null | undefined, ids: readonly string[] = TILE_IDS): string[] {
  let raw: unknown = null;
  try { raw = saved ? JSON.parse(saved) : null; } catch { raw = null; }
  const known = new Set(ids);
  const out: string[] = [];
  if (Array.isArray(raw)) for (const v of raw) if (typeof v === 'string' && known.has(v) && !out.includes(v)) out.push(v);
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}

/** The order with one tile moved one place up (step -1) or down (step 1). A tile at either end stays where it is. */
export function moveTile(order: readonly string[], id: string, step: -1 | 1): string[] {
  const i = order.indexOf(id), j = i + step;
  if (i < 0 || j < 0 || j >= order.length) return [...order];
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
