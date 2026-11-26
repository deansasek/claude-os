// The reader text of a page, as the tablet sends it in a 'reader' event. Pure: no imports, so tests can load it.
export interface ReaderBlock { tag: string; text: string }
export interface Article { title?: string; byline?: string; host?: string; blocks: ReaderBlock[] }

/** The article in the reader JSON, or null when there is no readable text (empty, bad JSON, no blocks). */
export function articleOf(json: string): Article | null {
  if (!json) return null;
  let a: unknown;
  try { a = JSON.parse(json); } catch { return null; }
  if (!a || typeof a !== 'object') return null;
  const blocks = (a as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  return a as Article;
}
