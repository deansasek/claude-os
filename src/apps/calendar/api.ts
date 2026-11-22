// Shapes of what the Calendar app's server routes send to the page (and to Home and voice).
// Served to the browser: nothing secret lives here. The calendar address stays in .calendar-config.json on the
// PC and the page only ever sees it masked (the host and "…").

/** One event on one day. An event that runs over both days is listed on each. */
export interface CalEvent {
  title: string;
  start: string;          // ISO time; for an all-day event, local midnight of its first day
  end: string;            // ISO time (exclusive)
  allDay: boolean;
  day: 'today' | 'tomorrow';
  location?: string;
}

/** GET /api/calendar/events. status: 'not_set' (no address yet), 'error' (and no events to show), or 'ok'. */
export interface CalEvents {
  status: 'ok' | 'not_set' | 'error';
  events: CalEvent[];     // today, then tomorrow; all-day events first, then by start time
  today: string;          // the PC's date, YYYY-MM-DD
  error?: string;         // with 'ok' too, when the last fetch failed and older events are shown (stale)
  stale?: boolean;
  fetchedAt?: string;     // when the calendar was last read (ISO)
}

/** GET /api/calendar/status */
export interface CalStatus {
  configured: boolean;
  address: string;        // masked: "calendar.google.com/…", never the secret path
}

export interface CalConfigResult extends CalStatus { ok: boolean; message?: string }

/** "9:00 AM" style, in the viewer's own clock; '' for an all-day event. */
export function eventTime(e: CalEvent, fmt: Intl.DateTimeFormat = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' })): string {
  return e.allDay ? '' : fmt.format(new Date(e.start));
}

/** The events still to come (or under way) at `now`, all-day events of today included. */
export function upcoming(events: CalEvent[], now = Date.now()): CalEvent[] {
  return events.filter(e => Date.parse(e.end) > now);
}
