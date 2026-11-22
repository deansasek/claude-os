// A new calendar event, checked before anything is written. Pure: no SDK, so Node tests load it.
// Only a title, a start, an end, and the all-day flag and place: nothing else is ever sent to the calendar.

export interface NewEvent { title: string; start: number; end: number; allDay: boolean; location?: string }

const MAX_TITLE = 120;
const MAX_PLACE = 200;
const MAX_SPAN_MS = 14 * 864e5;   // a hold for two weeks at most; longer is a mistake

/** The event, or the reason it is refused. */
export function checkNewEvent(input: unknown): { ok: true; event: NewEvent } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'No event given.' };
  const o = input as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.replace(/[\u0000-\u001f]/g, ' ').trim() : '';
  if (!title) return { ok: false, error: 'Give the event a name.' };
  if (title.length > MAX_TITLE) return { ok: false, error: `The name is longer than ${MAX_TITLE} characters.` };
  const start = typeof o.start === 'number' ? o.start : NaN;
  const end = typeof o.end === 'number' ? o.end : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { ok: false, error: 'The start and end times are not valid.' };
  if (end <= start) return { ok: false, error: 'The end must be after the start.' };
  if (end - start > MAX_SPAN_MS) return { ok: false, error: 'The event is longer than two weeks.' };
  const allDay = o.allDay === true;
  const location = typeof o.location === 'string' ? o.location.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, MAX_PLACE) : '';
  return { ok: true, event: { title, start, end, allDay, ...(location ? { location } : {}) } };
}
