// Calendar in the mock page (no hub): the ClaudeOS calendar with two events today and one tomorrow, a configured
// address shown as a masked one, and the calendar selector. The ClaudeOS events are kept for the session: adding,
// editing and deleting them works until a reload. The shapes are the ones in ../api.ts and the server's own replies.
import { defineMock } from '../../../core/web/mock-api.ts';
import type { CalEvent, CalEvents, CalStatus } from '../api.ts';
import { calendarsFor, type ShownFlags } from './calendars.ts';

interface Ev { id: string; title: string; start: number; end: number; allDay: boolean; location?: string; calendar: string }

const at = (day: number, h: number, m = 0): number => {
  const d = new Date(); d.setDate(d.getDate() + day); d.setHours(h, m, 0, 0); return d.getTime();
};
const events: Ev[] = [
  { id: 'e1', title: 'Sample lunch', start: at(0, 12), end: at(0, 13), allDay: false, location: 'Sample café', calendar: 'claudeos' },
  { id: 'e2', title: 'Sample dentist', start: at(0, 16, 30), end: at(0, 17), allDay: false, calendar: 'claudeos' },
  { id: 'e3', title: 'Sample birthday', start: at(1, 0), end: at(2, 0), allDay: true, calendar: 'claudeos' },
];
const flags: ShownFlags = {};
let nextId = 4;

const today = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayOf = (t: number): 'today' | 'tomorrow' => (new Date(t).toDateString() === new Date().toDateString() ? 'today' : 'tomorrow');
const iso = (t: number): string => new Date(t).toISOString();
const inRange = (e: Ev, from: number, to: number): boolean => e.start < to && e.end > from;
const asEvent = (e: Ev): CalEvent => ({ title: e.title, start: iso(e.start), end: iso(e.end), allDay: e.allDay, day: dayOf(e.start), ...(e.location ? { location: e.location } : {}) });
const bounds = (q: URLSearchParams): { from: number; to: number } => {
  const f = new Date(q.get('from') ?? '').getTime(), t = new Date(q.get('to') ?? '').getTime();
  return Number.isFinite(f) && Number.isFinite(t) ? { from: f, to: t } : { from: at(0, 0), to: at(2, 0) };
};
const status = (): CalStatus => ({ configured: true, address: 'calendar.google.com/…' });
const shown = () => ({ status: 'ok' as const, calendars: calendarsFor(true, flags) });

defineMock({
  'GET /api/calendar/status': (): CalStatus => status(),
  'POST /api/calendar/config': () => ({ ...status(), ok: true }),
  'GET /api/calendar/events': (): CalEvents => ({
    status: 'ok', today: today(), events: events.filter(e => e.start < at(2, 0) && e.end > at(0, 0)).map(asEvent),
  }),
  'GET /api/calendar/range': ({ query }) => {
    const b = bounds(query);
    return { status: 'ok', events: events.filter(e => inRange(e, b.from, b.to)).map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, calendar: e.calendar })) };
  },
  'GET /api/calendar/local': ({ query }) => {
    const b = bounds(query);
    return { status: 'ok', events: events.filter(e => inRange(e, b.from, b.to)) };
  },
  'POST /api/calendar/local-add': ({ body }) => {
    const b = body as { title?: unknown; start?: unknown; end?: unknown; allDay?: unknown; location?: unknown } | null;
    if (typeof b?.title !== 'string' || !b.title.trim() || typeof b.start !== 'number' || typeof b.end !== 'number' || b.end <= b.start)
      return { status: 'error', error: 'Give the event a title, a start and an end after the start.' };
    const e: Ev = { id: `e${nextId++}`, title: b.title.trim(), start: b.start, end: b.end, allDay: b.allDay === true, calendar: 'claudeos', ...(typeof b.location === 'string' && b.location ? { location: b.location } : {}) };
    events.push(e);
    return { status: 'ok', event: e };
  },
  'POST /api/calendar/local-update': ({ body }) => {
    const b = body as { id?: unknown; title?: unknown } | null;
    const e = events.find(x => x.id === b?.id);
    if (!e) return { status: 'error', error: 'That event is not on the ClaudeOS calendar.' };
    if (typeof b?.title === 'string' && b.title.trim()) e.title = b.title.trim();
    return { status: 'ok', event: e };
  },
  'POST /api/calendar/local-delete': ({ body }) => {
    const id = (body as { id?: unknown } | null)?.id;
    const i = events.findIndex(e => e.id === id);
    if (i >= 0) events.splice(i, 1);
    return { status: 'ok', removed: i >= 0 ? 1 : 0 };
  },
  'GET /api/calendar/calendars': () => shown(),
  'POST /api/calendar/calendar-shown': ({ body }) => {
    const b = body as { id?: unknown; shown?: unknown } | null;
    if ((b?.id === 'claudeos' || b?.id === 'ics') && typeof b.shown === 'boolean') flags[b.id] = b.shown;
    return shown();
  },
  'GET /api/calendar/connector': ({ query }) => (query.get('cached') === '1' ? { status: 'miss' } : { status: 'error', error: 'No calendar connector in the mock page.' }),
});
