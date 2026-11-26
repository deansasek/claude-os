// The "+ item" chips on Shopping. Pure: no DOM, so the node tests can import it (test/lists-history.test.ts).

/** The chips after a read. A good read (got is an array) replaces them. A failed read (got is null) keeps the
 *  chips already shown, minus any that is now open on Shopping (names compare without case). */
export function keptSuggest(prev: string[], got: string[] | null, openOnShopping: string[]): string[] {
  if (got) return got;
  const open = new Set(openOnShopping.map(t => t.trim().toLowerCase()));
  return prev.filter(t => !open.has(t.trim().toLowerCase()));
}
