// Calendar app routes (all under /api/calendar/):
//   GET  status            {configured, address}: the address only masked (its host and "…")
//   POST config            {address}   an ICS address (https://, http:// or webcal://); '' removes it.
//                          Saved in hub/.calendar-config.json on the PC
//   GET  events[?refresh=1] today's and tomorrow's events, sorted (a CalEvents); refresh=1 reads the calendar again
// Read-only: nothing here ever writes to the calendar.
import type { ServerApp } from '../../../core/server/app.ts';
import { manifest } from '../manifest.ts';
import { events, saveConfig, status } from './calendar.ts';

const app: ServerApp = {
  id: manifest.id,
  routes: [
    { method: 'GET', path: 'status', handle: () => status() },
    { method: 'POST', path: 'config', handle: ({ body }) => saveConfig((body as Record<string, unknown> | null)?.address) },
    { method: 'GET', path: 'events', handle: ({ query }) => events(query.get('refresh') === '1') },
  ],
};
export default app;
