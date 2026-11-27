// Put a removed Reading list entry back, and read the saved list. Pure logic: no side effects.

export interface Later { url: string; title: string; json: string; at: number }

/** The saved Reading list. Anything that is not a list reads as empty; an entry with no url is dropped, so one bad value cannot break the list. */
export function parseLater(raw: string | null | undefined): Later[] {
  let v: unknown;
  try { v = JSON.parse(raw || '[]'); } catch { return []; }
  if (!Array.isArray(v)) return [];
  const out: Later[] = [];
  for (const x of v) {
    if (typeof x !== 'object' || x === null) continue;
    const r = x as Record<string, unknown>;
    if (typeof r.url !== 'string') continue;
    out.push({ url: r.url, title: typeof r.title === 'string' ? r.title : '', json: typeof r.json === 'string' ? r.json : '', at: typeof r.at === 'number' ? r.at : 0 });
  }
  return out;
}

// Returns a new list. An entry with the same url as item is dropped first (the page may have been saved again).
// item goes back at index at, or at the end when the list is shorter.
export function restoreLater<T extends { url: string }>(list: T[], item: T, at: number): T[] {
  const rest = list.filter(x => x.url !== item.url);
  const out = rest.slice();
  out.splice(Math.min(at, rest.length), 0, item);
  return out;
}
