// Merges the events of one range for the range route (index.ts): the ICS events, the ClaudeOS calendar's events and,
// with no address, the claude.ai connector's events for one day. Each event keeps its calendar id. Pure: no file and
// no network, so Node tests load it.
import type { ConnEvent } from './connector-parse.ts';
import { tagCalendar } from '../web/calendars.ts';
import type { CalEvent, CalEvents } from '../api.ts';

export interface RangeEvent { id?: string; title: string; start: number; end: number; allDay: boolean; location?: string; calendar?: string }
export interface RangeAnswer { status: 'ok' | 'not_set' | 'error'; events: RangeEvent[]; error?: string; stale?: boolean }
export type ConnectorRead = { status: 'ok'; events: ConnEvent[] } | { status: 'error'; error: string };

const byStart = (x: RangeEvent, y: RangeEvent): number => x.start - y.start || x.title.localeCompare(y.title);

/**
 * ext: the ICS read for the range. local: the ClaudeOS events in the range. conn: the connector's read for the range,
 * or null when the range is not one the connector reads (only a single today or tomorrow is).
 * With no address, a connector read is merged in, so local events never hide the connector's events.
 */
/** The connector's read for a range's day (null when the range is not one day the connector reads). */
export type ConnectorDay = 'today' | 'tomorrow';

/**
 * The connector source for one range. An automatic request (the page's 5-minute timer, auto=1) never reads the connector:
 * it gets a fresh cached read or null. Only a user request (open, Refresh, moving the day) may call read.
 */
export async function connectorForRange(
  day: ConnectorDay | null,
  auto: boolean,
  src: { cached: (day: ConnectorDay) => ConnectorRead | null; read: (day: ConnectorDay) => Promise<ConnectorRead> },
): Promise<ConnectorRead | null> {
  if (!day) return null;
  if (auto) return src.cached(day);
  return src.read(day);
}

export function mergeRange(ext: RangeAnswer, local: RangeEvent[], conn: ConnectorRead | null): RangeAnswer {
  if (ext.status === 'ok') return { ...ext, events: [...ext.events, ...local].sort(byStart) };
  if (conn?.status === 'ok') return { status: 'ok', events: [...local, ...tagCalendar(conn.events, 'connector')].sort(byStart) };
  if (conn) {
    if (!local.length) return { status: 'error', events: [], error: conn.error };
    return { status: 'ok', events: local, error: conn.error, stale: true };
  }
  if (!local.length) return ext;
  return { status: 'ok', events: local, ...(ext.status === 'error' ? { error: ext.error, stale: true } : {}) };
}

/** The local (ClaudeOS) events for today and tomorrow, added to the events answer. Pure: no file and no network. */
export function withLocalDays(
  answer: CalEvents,
  local: { title: string; start: number; end: number; allDay: boolean; location?: string }[],
  d0: number, d1: number, d2: number,
  cap = 200,
): CalEvents {
  const extra: CalEvent[] = [];
  for (const e of local) {
    for (const [day, from, to] of [['today', d0, d1], ['tomorrow', d1, d2]] as const) {
      if (e.start < to && (e.end > from || (e.end === e.start && e.start >= from))) {
        extra.push({ title: e.title, start: new Date(e.start).toISOString(), end: new Date(e.end).toISOString(), allDay: e.allDay, day, ...(e.location ? { location: e.location } : {}) });
      }
    }
  }
  // a failed read with no local events stays a failed read; with local events it shows them, marked stale
  if (answer.status === 'error' && !extra.length) return answer;
  extra.sort((a, b) => (a.day === b.day ? 0 : a.day === 'today' ? -1 : 1) || (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1)
    || Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title));
  const all = [...answer.events, ...extra].sort((a, b) => (a.day === b.day ? 0 : a.day === 'today' ? -1 : 1) || (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1)
    || Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title));
  return {
    ...answer,
    status: answer.status === 'error' ? 'ok' : answer.status,
    events: all.slice(0, cap),
    ...(answer.status === 'error' ? { stale: true } : {}),
  };
}
