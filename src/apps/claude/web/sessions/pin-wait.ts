// The wait shown after too many wrong PINs on the Claude pad. The PC sends the wait in seconds (guard.ts, lockedFor).
// The PC's lockout is 30 seconds (settings/server/pin.ts), so that is the default when no wait is sent.

export const LOCK_DEFAULT_SECS = 30;

/** "Too many tries. Wait 30 seconds.": whole seconds, at least 1, and "second" for exactly one. */
export function waitText(secs: number): string {
  const s = Math.max(1, Math.ceil(secs));
  return `Too many tries. Wait ${s} ${s === 1 ? 'second' : 'seconds'}.`;
}
