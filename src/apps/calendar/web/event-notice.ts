// The "starts soon" notice for calendar events (index.ts): which timed events are due, and which ones were already
// told. Pure: no DOM and no store (index.ts reads and writes the record). test/calendar-event-notice.test.ts runs it.
import type { CalEvent } from '../api.ts';

export const NOTICE_LEAD_MS = 10 * 60e3;   // the notice comes this long before the start
const KEEP_MS = 24 * 3600e3;               // a record older than a day is dropped (the event is over)

/** Map from event key to its start (ms). Kept in local storage so a reload does not notify again. */
export type Notified = Record<string, number>;

/** A timed event's key: its start and its title, so a moved event is told again. */
export const eventKey = (e: CalEvent): string => `${e.start}|${e.title}`;

/** The timed events that start within the lead time, and that were not told yet. All-day events never qualify. */
export function dueNotices(events: CalEvent[], now: number, told: Notified): CalEvent[] {
  return events.filter(e => {
    if (e.allDay || Object.hasOwn(told, eventKey(e))) return false;
    const start = Date.parse(e.start);
    return Number.isFinite(start) && start - NOTICE_LEAD_MS <= now && now < start;
  });
}

/** The record without the entries whose event started more than a day ago. */
export function pruneNotified(told: Notified, now: number): Notified {
  const out: Notified = {};
  for (const [k, start] of Object.entries(told)) if (start > now - KEEP_MS) out[k] = start;
  return out;
}

/** The text of a notice: the title and the start, with the place when there is one. */
export function noticeText(e: CalEvent, startTime: string): { title: string; body: string } {
  return { title: `Coming up: ${e.title}`, body: `Starts at ${startTime}${e.location ? ` · ${e.location}` : ''}` };
}
