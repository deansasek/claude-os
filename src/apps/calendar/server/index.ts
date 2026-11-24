// Calendar app routes (all under /api/calendar/):
//   GET  status            {configured, address}: the address only masked (its host and "…")
//   POST config            {address}   an ICS address (https://, http:// or webcal://); '' removes it.
//                          Saved in .calendar-config.json on the PC
//   GET  events[?refresh=1] today's and tomorrow's events, sorted (a CalEvents); refresh=1 reads the calendar again
//   GET  local?from&to     the ClaudeOS calendar's events in a range (no account needed)
//   POST local-add         {title, start, end, allDay, location?} adds one event to the ClaudeOS calendar
//   POST local-update      {id, ...fields sent} changes one; the fields not sent keep their values
//   POST local-delete      {id} removes one
//   GET  calendars         the calendars (ClaudeOS, the ICS address or the connector) with their shown flags
//   POST calendar-shown    {id, shown} stores one calendar's shown flag on the PC (calendar-shown.json)
// The local routes write only calendar-local.json on the PC. The external routes never write to the calendar.
import type { ServerApp } from '../../../core/server/app.ts';
import { manifest } from '../manifest.ts';
import { events, eventsBetween, saveConfig, status } from './calendar.ts';
import { rangeBounds } from './range.ts';
import { addConnectorEvent } from './connector-write.ts';
import { cachedConnectorEvents, connectorEvents } from './connector.ts';
import { addLocalEvent, deleteLocalEvent, localEventsBetween, updateLocalEvent } from './local.ts';
import { loadFlags, setShown } from './calendar-shown.ts';
import { calendarsFor } from '../web/calendars.ts';

/** The range from both calendars: the local events always, the external ones when there is an address.
 *  With no address and no local events the answer is the external one unchanged ('not_set'), so the connector still answers. */
async function rangeWithLocal(b: { from: number; to: number }, refresh: boolean): Promise<Awaited<ReturnType<typeof eventsBetween>>> {
  const local = localEventsBetween(b.from, b.to);
  const ext = await eventsBetween(b.from, b.to, 3000, refresh);
  if (ext.status === 'ok') return { ...ext, events: [...ext.events, ...local].sort((x, y) => x.start - y.start || x.title.localeCompare(y.title)) };
  if (!local.length) return ext;
  return { status: 'ok', events: local, ...(ext.status === 'error' ? { error: ext.error, stale: true } : {}) };
}

const app: ServerApp = {
  id: manifest.id,
  routes: [
    { method: 'GET', path: 'status', handle: () => status() },
    { method: 'POST', path: 'config', handle: ({ body }) => saveConfig((body as Record<string, unknown> | null)?.address) },
    { method: 'GET', path: 'events', handle: ({ query }) => events(query.get('refresh') === '1') },
    // adds one event through the connector (no longer called by the add form, which uses local-add; a later PR removes it)
    { method: 'POST', path: 'add', handle: ({ body }) => addConnectorEvent(body) },
    // the events from one day (inclusive) to another (exclusive), for the Day, Week, Month and Year views:
    // the local calendar's events with the external ones (rangeWithLocal)
    { method: 'GET', path: 'range', handle: ({ query }) => {
      const b = rangeBounds(query.get('from') ?? '', query.get('to') ?? '');
      return b ? rangeWithLocal(b, query.get('refresh') === '1') : { status: 'error', events: [], error: 'That range is not valid.' };
    } },
    // the ClaudeOS calendar on its own: no account, no Claude turn. Each change is checked on the PC (local.ts).
    { method: 'GET', path: 'local', handle: ({ query }) => {
      const b = rangeBounds(query.get('from') ?? '', query.get('to') ?? '');
      return b ? { status: 'ok', events: localEventsBetween(b.from, b.to) } : { status: 'error', events: [], error: 'That range is not valid.' };
    } },
    { method: 'POST', path: 'local-add', handle: ({ body }) => addLocalEvent(body) },
    { method: 'POST', path: 'local-update', handle: ({ body }) => updateLocalEvent(body) },
    { method: 'POST', path: 'local-delete', handle: ({ body }) => deleteLocalEvent((body as Record<string, unknown> | null)?.id) },
    // the calendar selector: which calendars are drawn. The page hides the events of a calendar stored as hidden.
    { method: 'GET', path: 'calendars', handle: () => ({ status: 'ok', calendars: calendarsFor(status().configured, loadFlags()) }) },
    { method: 'POST', path: 'calendar-shown', handle: ({ body }) => {
      const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
      return setShown(b.id, b.shown, status().configured);
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
