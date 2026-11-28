// The day the Calendar opens on (src/apps/calendar/web/index.ts). Pure: no DOM and no imports, so the test can run it under node.

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a: Date, b: Date): boolean => startOfDay(a).getTime() === startOfDay(b).getTime();

/**
 * The anchor to show when the Calendar opens. The view follows the clock only while it still sits on the day it was set to
 * (`lastToday`). A day the user moved to stays where it is.
 */
export function followedAnchor(anchor: Date, lastToday: Date, now: Date): Date {
  return sameDay(anchor, lastToday) && !sameDay(lastToday, now) ? startOfDay(now) : anchor;
}
