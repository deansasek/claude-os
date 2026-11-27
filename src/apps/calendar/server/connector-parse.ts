// Reads the answer of a connector read (Calendar through the claude.ai Google Calendar connector) into events.
// Pure: no SDK, no network, so Node tests can load it. The model is asked for a JSON array only; this
// accepts a bare array or one in a code fence, and drops any item that is not a usable event.

export interface ConnEvent { title: string; start: number; end: number; allDay: boolean }

/** The events in an answer: [] for a valid empty list, null when no JSON array can be read at all. */
export function parseConnectorEvents(text: string): ConnEvent[] | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const a = body.indexOf('['), b = body.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  let raw: unknown;
  try { raw = JSON.parse(body.slice(a, b + 1)); } catch { return null; }
  if (!Array.isArray(raw)) return null;
  const out: ConnEvent[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120) : '';
    const start = typeof o.start === 'string' ? Date.parse(o.start) : NaN;
    const end = typeof o.end === 'string' ? Date.parse(o.end) : start;
    if (!title || !Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    out.push({ title, start, end, allDay: o.allDay === true });
  }
  return out.sort((x, y) => x.start - y.start).slice(0, 50);
}

/** The reply for a connector read that failed: the fixed text the tablet shows. The raw error (it can hold a PC path) goes to the PC log only. */
export function connectorError(e: unknown): { status: 'error'; error: string } {
  console.log('calendar: connector read failed', e);
  return { status: 'error', error: 'Couldn’t read the claude.ai calendar connector.' };
}
