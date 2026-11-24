// The "starts soon" notice for calendar events (index.ts): which timed events are due, and which ones were already
// told. Pure: no DOM and no store (index.ts reads and writes the record). test/calendar-event-notice.test.ts runs it.
import type { CalEvent } from '../api.ts';

export const NOTICE_LEAD_MS = 10 * 60e3;   // the notice comes this long before the start
const KEEP_MS = 24 * 3600e3;               // a record older than a day is dropped (the event is over)

/** Map from event key to its start (ms). Kept in local storage so a reload does not notify again. */
export type Notified = Record<string, number>;

/** A timed event's key: its start and its title, so a moved event is told again. */
export const eventKey = (e: CalEvent): string => `${e.start}|${e.title}`;

/**
 * The timed events that start within the lead time, and that were not told yet. All-day events never qualify.
 * An event can appear twice (a timed event past midnight is listed as today and as tomorrow), so each key comes once.
 */
export function dueNotices(events: CalEvent[], now: number, told: Notified): CalEvent[] {
  const seen = new Set<string>();
  return events.filter(e => {
    const key = eventKey(e);
    if (e.allDay || seen.has(key) || Object.hasOwn(told, key)) return false;
    const start = Date.parse(e.start);
    if (!(Number.isFinite(start) && start - NOTICE_LEAD_MS <= now && now < start)) return false;
    seen.add(key);
    return true;
  });
}

/** The record without the entries whose event started more than a day ago. */
export function pruneNotified(told: Notified, now: number): Notified {
  const out: Notified = {};
  for (const [k, start] of Object.entries(told)) if (start > now - KEEP_MS) out[k] = start;
  return out;
}

/** The text of a notice: the title and the start, with the place when there is one. From a copy, it says when the PC read the calendar. */
export function noticeText(e: CalEvent, startTime: string, copyTime?: string): { title: string; body: string } {
  const where = e.location ? ` · ${e.location}` : '';
  const from = copyTime ? ` · from a copy read at ${copyTime}` : '';
  return { title: `Coming up: ${e.title}`, body: `Starts at ${startTime}${where}${from}` };
}

// ---------- the tablet's copy of the events, for notices while the PC is off (index.ts keeps it) ----------
export const COPY_MAX_MS = 6 * 3600e3;   // an older copy is not used for notices: its events may have moved or gone

/** The events the PC last sent, and when the PC read the calendar (ms). */
export interface EventCopy { readAt: number; events: CalEvent[] }

/** The saved copy, or null when the text is missing or not a copy. */
export function parseCopy(raw: string | null): EventCopy | null {
  try {
    const v = JSON.parse(raw || 'null') as Partial<EventCopy> | null;
    if (!v || !Number.isFinite(v.readAt) || !Array.isArray(v.events)) return null;
    return { readAt: v.readAt as number, events: v.events };
  } catch { return null; }
}

/** Whether a copy read at `readAt` may give notices at `now`. */
export const copyUsable = (readAt: number, now: number): boolean => now - readAt <= COPY_MAX_MS;
