// The lock screen glance line (src/core/web/lock.ts): counts and times only, never notification titles or text.
// Pure: no DOM and no imports, so the test can run it under node.

/**
 * One line for the lock face: "3 new notifications · Alarm 7:00 AM · Timer 4:59".
 * Each part is optional. Returns '' when there is nothing to show.
 */
export function glanceLine(count: number, alarm: string | null, timer: string | null): string {
  const parts: string[] = [];
  if (count > 0) parts.push(`${count} ${count === 1 ? 'notification' : 'notifications'}`);
  if (alarm) parts.push(alarm);
  if (timer) parts.push(`Timer ${timer}`);
  return parts.join(' · ');
}

/** ms to the next lock repaint: the next second while a timer runs, else the next minute. */
export function glanceDelay(now: number, timerRunning: boolean): number {
  return timerRunning ? 1000 - now % 1000 + 50 : 60_000 - now % 60_000 + 50;
}
