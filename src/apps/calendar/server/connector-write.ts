// Adds one event to the Google calendar through the claude.ai Google Calendar connector. Only the create tool is allowed.
// It runs only when the family taps Add in the Calendar app (the route is never called by a timer or a routine).
import os from 'node:os';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { forgetConnectorCache } from './connector.ts';
import { checkNewEvent, type NewEvent } from './new-event.ts';

const CREATE = /create_event/i;
const SCOPE = /calendar/i;

export type AddAnswer = { status: 'ok'; message: string } | { status: 'error'; error: string };

/** Creates the event after a check. The connector's answer is read as JSON; a refusal is reported in words. */
export async function addConnectorEvent(input: unknown): Promise<AddAnswer> {
  const checked = checkNewEvent(input);
  if (!checked.ok) return { status: 'error', error: checked.error };
  const ev: NewEvent = checked.event;
  const when = ev.allDay
    ? `all day on ${new Date(ev.start).toDateString()}`
    : `from ${new Date(ev.start).toString()} to ${new Date(ev.end).toString()}`;
  const prompt = `Create one event on my primary Google Calendar using the Google Calendar connector. Use exactly these details: ` +
    `title "${ev.title}", ${when}${ev.location ? `, location "${ev.location}"` : ''}. Do not change or delete anything else. ` +
    'Reply with only a JSON object: {"created": true} or {"created": false, "reason": "..."}.';
  const q = query({
    prompt,
    options: {
      cwd: os.tmpdir(), permissionMode: 'default', maxTurns: 6, persistSession: false,
      canUseTool: async (name: string, input: Record<string, unknown>) => (CREATE.test(name) && SCOPE.test(name)
        ? { behavior: 'allow' as const, updatedInput: input }
        : { behavior: 'deny' as const, message: 'only creating an event is allowed' }),
    },
  });
  let text = '';
  try {
    for await (const msg of q) if (msg.type === 'result') text = msg.subtype === 'success' ? String(msg.result ?? '') : '';
  } catch (e) { return { status: 'error', error: String((e as Error).message || e).slice(0, 200) }; }
  const m = text.match(/\{[\s\S]*\}/);
  let answer: { created?: unknown; reason?: unknown } | null = null;
  try { answer = m ? JSON.parse(m[0]) : null; } catch { answer = null; }
  if (!answer) return { status: 'error', error: 'The calendar did not confirm the event. Check it before adding it again.' };
  if (answer.created !== true) {
    return { status: 'error', error: typeof answer.reason === 'string' ? answer.reason.slice(0, 200) : 'The calendar refused the event.' };
  }
  forgetConnectorCache();   // the day views read again next time they are opened
  return { status: 'ok', message: `Added “${ev.title}” to your calendar.` };
}
