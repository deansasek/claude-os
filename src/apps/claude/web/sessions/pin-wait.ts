// The wait shown after too many wrong PINs on the Claude pad. The PC sends the wait in seconds (guard.ts, lockedFor).
// The PC's lockout is 30 seconds (settings/server/pin.ts), so that is the default when no wait is sent.
// pinMessage() picks the line under the PIN pad for each unlock answer; a null answer means the PC did not reply.
import type { UnlockResult } from '../../api.ts';

export const LOCK_DEFAULT_SECS = 30;

/** "Too many tries. Wait 30 seconds.": whole seconds, at least 1, and "second" for exactly one. */
export function waitText(secs: number): string {
  const s = Math.max(1, Math.ceil(secs));
  return `Too many tries. Wait ${s} ${s === 1 ? 'second' : 'seconds'}.`;
}

/** The line under the PIN pad after an unlock answer. A null answer means the request failed (PC unreachable). */
export function pinMessage(r: UnlockResult | null): string {
  if (!r) return 'Can’t reach your PC just now. Try again.';
  if (r.error === 'locked') return waitText(r.retryIn || LOCK_DEFAULT_SECS);
  if (r.error === 'no_pin') return 'No PIN is set on the PC yet.';
  return 'That’s not it. Try again.';
}
