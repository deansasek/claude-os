// The words on Home's Dinner row, kept free of the DOM so a test can read them (src/apps/home/web/index.ts).
// The row is narrow: the value sits beside its label, and the detail sits under it.

const freeWords = (n: number | null): string => {
  if (n === null) return '';
  if (n === 0) return 'No free nights left';
  return `${n} free night${n === 1 ? '' : 's'} left`;
};

/**
 * The row's value and detail:
 * "Loading…" before the first read; "Can’t reach the calendar" when the read failed with nothing shown before;
 * the dinner for tonight ("Tacos", with "Tonight" under it); or "Nothing planned" when no dinner is set.
 * The detail also says how many nights this week still have no dinner ("2 free nights left").
 * When the last read failed and a dinner was read before, the detail starts with "Offline · ", so an old dinner never looks current.
 */
export function dinnerRow(tonight: string | null, state: 'loading' | 'ok' | 'failed', failedBefore: boolean, freeLeft: number | null = null): { val: string; sub: string } {
  if (state === 'loading') return { val: 'Loading…', sub: '' };
  if (state === 'failed' && !tonight) return { val: 'Can’t reach the calendar', sub: '' };
  const free = freeWords(freeLeft);
  if (!tonight) return { val: 'Nothing planned', sub: [state === 'failed' ? 'Offline' : '', free].filter(Boolean).join(' · ') };
  const when = state === 'failed' || failedBefore ? 'Offline · Tonight' : 'Tonight';
  return { val: tonight, sub: [when, free].filter(Boolean).join(' · ') };
}
