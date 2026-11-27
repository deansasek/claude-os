// Calendar events from the claude.ai Google Calendar connector, for the PC when no calendar address is set.
// One read-only Claude turn per day, cached for 15 minutes on the PC. The connector's sign-in stays on claude.ai:
// nothing Google-branded reaches the tablet, and no Google token is kept here or on the tablet.
import os from 'node:os';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { type ConnEvent, connectorError, parseConnectorEvents } from './connector-parse.ts';

const TTL_MS = 15 * 60e3;
const READ = /(list|get|read|search|find)/i;
const SCOPE = /calendar|event/i;
const cache = new Map<string, { at: number; events: ConnEvent[] }>();

/** The PC's local date for today or tomorrow, as YYYY-MM-DD. */
function dateFor(day: 'today' | 'tomorrow'): string {
  const d = new Date();
  if (day === 'tomorrow') d.setDate(d.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type ConnectorAnswer = { status: 'ok'; events: ConnEvent[]; cached: boolean } | { status: 'error'; error: string };

/** The cached events for a day, with no Claude turn: a miss when nothing fresh is cached. Timed routines use this. */
export function cachedConnectorEvents(day: 'today' | 'tomorrow'): ConnectorAnswer | { status: 'miss' } {
  const hit = cache.get(dateFor(day));
  if (hit && Date.now() - hit.at < TTL_MS) return { status: 'ok', events: hit.events, cached: true };
  return { status: 'miss' };
}

export async function connectorEvents(day: 'today' | 'tomorrow'): Promise<ConnectorAnswer> {
  const hit = cache.get(dateFor(day));
  if (hit && Date.now() - hit.at < TTL_MS) return { status: 'ok', events: hit.events, cached: true };
  const date = dateFor(day);
  const prompt = `List my Google Calendar events for ${date} (my local day) using the Google Calendar connector. Read only. ` +
    'Reply with only a JSON array, nothing else: [{"title": string, "start": ISO 8601 with offset, "end": ISO 8601 with offset, "allDay": boolean}]. Reply [] when there are none.';
  let text = '';
  try {
    const q = query({
      prompt,
      options: {
        cwd: os.tmpdir(), permissionMode: 'default', maxTurns: 6, persistSession: false,
        canUseTool: async (name: string, input: Record<string, unknown>) => (READ.test(name) && SCOPE.test(name)
          ? { behavior: 'allow' as const, updatedInput: input }
          : { behavior: 'deny' as const, message: 'read-only' }),
      },
    });
    for await (const msg of q) if (msg.type === 'result') text = msg.subtype === 'success' ? String(msg.result ?? '') : '';
  } catch (e) { return connectorError(e); }
  const events = parseConnectorEvents(text);
  if (!events) return { status: 'error', error: 'The connector answer had no event list.' };
  cache.set(dateFor(day), { at: Date.now(), events });
  return { status: 'ok', events, cached: false };
}
