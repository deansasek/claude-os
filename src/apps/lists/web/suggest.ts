// The "+ item" chips on Shopping. Pure: no DOM, so the node tests can import it (test/lists-history.test.ts).

/** The chips after a read. A good read (got is an array) replaces the chips shown; a failed read (got is null) keeps
 *  them. Either way, a chip that is now open on Shopping is dropped (names compare without case). */
export function keptSuggest(prev: string[], got: string[] | null, openOnShopping: string[]): string[] {
  const open = new Set(openOnShopping.map(t => t.trim().toLowerCase()));
  return (got ?? prev).filter(t => !open.has(t.trim().toLowerCase()));
}
