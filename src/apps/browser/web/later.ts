// Put a removed Reading list entry back. Pure logic: no side effects.

// Returns a new list. An entry with the same url as item is dropped first (the page may have been saved again).
// item goes back at index at, or at the end when the list is shorter.
export function restoreLater<T extends { url: string }>(list: T[], item: T, at: number): T[] {
  const rest = list.filter(x => x.url !== item.url);
  const out = rest.slice();
  out.splice(Math.min(at, rest.length), 0, item);
  return out;
}
