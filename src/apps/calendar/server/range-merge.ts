// Merges the events of one range for the range route (index.ts): the ICS events, the ClaudeOS calendar's events and,
// with no address, the claude.ai connector's events for one day. Each event keeps its calendar id. Pure: no file and
// no network, so Node tests load it.
import type { ConnEvent } from './connector-parse.ts';
import { tagCalendar } from '../web/calendars.ts';

export interface RangeEvent { title: string; start: number; end: number; allDay: boolean; location?: string; calendar?: string }
export interface RangeAnswer { status: 'ok' | 'not_set' | 'error'; events: RangeEvent[]; error?: string; stale?: boolean }
export type ConnectorRead = { status: 'ok'; events: ConnEvent[] } | { status: 'error'; error: string };

const byStart = (x: RangeEvent, y: RangeEvent): number => x.start - y.start || x.title.localeCompare(y.title);

/**
 * ext: the ICS read for the range. local: the ClaudeOS events in the range. conn: the connector's read for the range,
 * or null when the range is not one the connector reads (only a single today or tomorrow is).
 * With no address, a connector read is merged in, so local events never hide the connector's events.
 */
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
