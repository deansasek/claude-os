// Whether this page can reach the PC (the Hub). Wi-Fi can be up while the PC is off or the hub is restarting,
// so the status bar and Settings ask this instead of only navigator.onLine. The shell's version check reports each
// try: a few failures in a row mean the PC can't be reached, and one success means it can again.
const FAILS_BEFORE_DOWN = 2;   // one missed try is a blip; two in a row is the PC being away

let fails = 0;
const listeners = new Set<() => void>();

/** True unless the last tries failed: the PC has not answered for FAILS_BEFORE_DOWN checks in a row. */
export function hubReachable(): boolean {
  return fails < FAILS_BEFORE_DOWN;
}

/** Called with each version check: true if it reached the PC, false if it did not. */
export function reportHubCheck(reached: boolean): void {
  const before = hubReachable();
  fails = reached ? 0 : fails + 1;
  if (hubReachable() !== before) listeners.forEach(f => f());
}

/** Run f whenever reachability changes (reached again, or down). */
export function onHubReachable(f: () => void): void {
  listeners.add(f);
}
