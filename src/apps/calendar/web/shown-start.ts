// The start time shown for an event on one day of the Calendar (src/apps/calendar/web/index.ts). Pure: no DOM and no imports,
// so the test can run it under node.

/** The start to show on a day: the real start on the day it begins, the day's midnight on a day it runs on into. All-day events keep their start. */
export const shownStart = (e: { start: number; allDay: boolean }, dayStart: number): number =>
  e.allDay ? e.start : Math.max(e.start, dayStart);
