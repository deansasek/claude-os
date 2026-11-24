// Which stored settings go to the PC backup (Settings → Storage → Settings backup). Shared: the tablet filters what it
// sends, and the PC filters again before it keeps anything. Pure: no DOM and no imports, so the test runs under node.
//
// In: the os.* settings and the sidebar pins (rail.pins). Out: every key whose name contains token, key, secret or
// password; the sign-in state; the PIN state; and the notification history and its runtime flags (they are not settings).

const IN = /^(?:os\.|rail\.pins$)/;
const OUT = /token|key|secret|password|sign-?in|auth|pinset|os\.notes|wakepaused/i;

/** True when a stored key is a setting the backup keeps. */
export function backupKey(k: string): boolean { return IN.test(k) && !OUT.test(k); }

/** The values the backup keeps: only backup keys, and only short text values. Anything else is dropped. */
export function backupValues(src: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    if (backupKey(k) && typeof v === 'string' && v.length <= 2000) out[k] = v;
  }
  return out;
}
