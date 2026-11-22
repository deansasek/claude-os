// The PIN pad that ClaudeOS draws itself: the lock screen (lock.ts) and Settings' PIN sheet both use it, so they look
// the same. Keys 1-9, a blank, 0 and a delete key; Done is the host's own button. The pad's look is in core.css
// (.pin-card, .pin-dots, .pin-msg, .pin-keys). Not the Claude app's older pad (apps/claude/web/sessions/pin.ts).

/** A PIN is 4 to 6 digits (the server checks the same). */
export const PAD_MIN = 4;
export const PAD_MAX = 6;

const BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6H20v12H9.5L4 12z"/><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"/></svg>';

/** The keys, as markup for a .pin-keys element. */
export function padKeysHtml(): string {
  const digit = (k: string) => `<button type="button" data-k="${k}">${k}</button>`;
  return ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit).join('')
    + '<span class="pin-blank" aria-hidden="true"></span>'
    + digit('0')
    + `<button type="button" class="small" data-k="back" aria-label="Delete">${BACK}</button>`;
}

/** The key a click on the pad was for: a digit, 'back', or null (the blank, or not a key). */
export function padKey(e: Event): string | null {
  return (e.target as Element).closest<HTMLElement>('button')?.dataset.k ?? null;
}

/** The dots: one per digit allowed, the first `n` filled. */
export function paintDots(el: HTMLElement, n: number): void {
  el.innerHTML = Array.from({ length: PAD_MAX }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
}
