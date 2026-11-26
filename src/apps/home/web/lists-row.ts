// The words on Home's Shopping row, kept free of the DOM so a test can read them (src/apps/home/web/index.ts).
// The row is narrow: the value sits beside its label, and the detail sits under it.

export interface RowList { items: { done: boolean; text: string }[] }

/**
 * The row's value and detail:
 * "Loading…" before the first read; "Can’t reach the lists" when the first read failed;
 * "3 to get" + the first two open items ("Milk, eggs…"); "Nothing to get" when all are done.
 * When the last read failed and the lists were read before, the detail starts with "Offline · " (or reads "Offline" when empty),
 * so an old list never looks current.
 */
export function listsRow(lists: RowList | null, failed: boolean): { val: string; sub: string } {
  if (!lists) return { val: failed ? 'Can’t reach the lists' : 'Loading…', sub: '' };
  const open = lists.items.filter(i => !i.done);
  const val = open.length ? `${open.length} to get` : 'Nothing to get';
  const list = open.length ? open.slice(0, 2).map(i => i.text).join(', ') + (open.length > 2 ? '…' : '') : '';
  if (!failed) return { val, sub: list };
  return { val, sub: list ? `Offline · ${list}` : 'Offline' };
}
