// Calendar app routes (all under /api/calendar/):
//   GET  status            {configured, address}: the address only masked (its host and "…")
//   POST config            {address}   an ICS address (https://, http:// or webcal://); '' removes it.
//                          Saved in .calendar-config.json on the PC
//   GET  events[?refresh=1] today's and tomorrow's events, sorted (a CalEvents); refresh=1 reads the calendar again
// Read-only: nothing here ever writes to the calendar.
import type { ServerApp } from '../../../core/server/app.ts';
import { manifest } from '../manifest.ts';
import { events, eventsBetween, saveConfig, status } from './calendar.ts';
import { rangeBounds } from './range.ts';
import { cachedConnectorEvents, connectorEvents } from './connector.ts';

const app: ServerApp = {
  id: manifest.id,
  routes: [
    { method: 'GET', path: 'status', handle: () => status() },
    { method: 'POST', path: 'config', handle: ({ body }) => saveConfig((body as Record<string, unknown> | null)?.address) },
    { method: 'GET', path: 'events', handle: ({ query }) => events(query.get('refresh') === '1') },
    // the events from one day (inclusive) to another (exclusive), for the Day, Week, Month and Year views
    { method: 'GET', path: 'range', handle: ({ query }) => {
      const b = rangeBounds(query.get('from') ?? '', query.get('to') ?? '');
      return b ? eventsBetween(b.from, b.to, 3000, query.get('refresh') === '1') : { status: 'error', events: [], error: 'That range is not valid.' };
    } },
    // the claude.ai Google Calendar connector (connector.ts): one read per day, cached 15 minutes on the PC
    // cached=1: only what is already read (no Claude turn); a miss says so. Timed routines use this.
    { method: 'GET', path: 'connector', handle: ({ query }) => {
      const day = query.get('day') === 'tomorrow' ? 'tomorrow' : 'today';
      return query.get('cached') === '1' ? cachedConnectorEvents(day) : connectorEvents(day);
    } },
  ],
};
export default app;
