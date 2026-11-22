// Claude's tablet tools, as one in-process MCP server (claudeos_tablet) that turns.ts adds to each session:
// set a timer, an alarm or a reminder in the tablet's Clock, or show a ClaudeOS notice. Each call is an ordinary
// tool call, so it goes through canUseTool (the approval card on the tablet) first. The arguments are checked here;
// the job then goes to the tablet through the same relay as the browser tools (browser.ts), and the tablet's Clock
// app sets it (the same timer, alarms and ringing as tapping them in). Each result is one plain sentence.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { sendJob, type TabletOp } from './browser.ts';

export const MIN_MINUTES = 1, MAX_MINUTES = 720;
export const TEXT_MAX = 80;
export const MAX_ACTIVE = 20;   // timers and alarms switched on, in total

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) });

/** How many timers and alarms are on, as the tablet said with its last poll (null until it has). */
let activeOnTablet: number | null = null;
export function noteTabletActive(n: unknown): void {
  if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 1000) activeOnTablet = n;
}

/** Trimmed, one line, at most TEXT_MAX characters. */
export function cleanText(s: unknown): string {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX).trim() : '';
}

/** "17:05" or "7:05" → { h: 17, m: 5 }; null if it isn't a 24-hour time. */
export function parseHHMM(s: unknown): { h: number; m: number } | null {
  const r = typeof s === 'string' ? /^\s*(\d{1,2}):(\d{2})\s*$/.exec(s) : null;
  if (!r) return null;
  const h = +r[1], m = +r[2];
  return h <= 23 && m <= 59 ? { h, m } : null;
}

/** "10 minutes", "1 hour and 30 minutes", "1 minute and 30 seconds". */
export function minutesWords(minutes: number): string {
  const s = Math.round(minutes * 60), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  const part = (n: number, w: string) => (n ? `${n} ${w}${n === 1 ? '' : 's'}` : '');
  return [part(h, 'hour'), part(m, 'minute'), part(sec, 'second')].filter(Boolean).join(' and ');
}

export type Checked = { ok: true; op: TabletOp; args: Record<string, unknown> } | { ok: false; error: string };
const full = (): string | null => (activeOnTablet != null && activeOnTablet >= MAX_ACTIVE
  ? `There are already ${activeOnTablet} timers and alarms on (the most is ${MAX_ACTIVE}). Ask the user to turn one off in the Clock first.` : null);

/** Check a tool's arguments; the error is a plain sentence for Claude. */
export function check(op: TabletOp, input: Record<string, unknown>): Checked {
  if (op === 'notify') {
    const title = cleanText(input.title), body = cleanText(input.body);
    if (!title) return { ok: false, error: 'The notification needs a title.' };
    return { ok: true, op, args: { title, body } };
  }
  const label = cleanText(input.label);
  if (op === 'timer') {
    const minutes = typeof input.minutes === 'number' ? input.minutes : NaN;
    if (!Number.isFinite(minutes)) return { ok: false, error: 'The timer needs a number of minutes.' };
    if (minutes < MIN_MINUTES || minutes > MAX_MINUTES) return { ok: false, error: `A timer can be from ${MIN_MINUTES} to ${MAX_MINUTES} minutes (12 hours). For a longer wait, set an alarm or a reminder for the time.` };
    const busy = full();
    if (busy) return { ok: false, error: busy };
    return { ok: true, op, args: { ms: Math.round(minutes * 60) * 1000, words: minutesWords(minutes), label } };
  }
  const t = parseHHMM(input.time);
  if (!t) return { ok: false, error: `“${String(input.time ?? '').slice(0, 20)}” isn’t a time I can use. Give it as HH:MM on the 24-hour clock, like 17:00.` };
  if (op === 'reminder') {
    const what = cleanText(input.text);
    if (!what) return { ok: false, error: 'The reminder needs some text to show, like “Take the chicken out”.' };
    const busy = full();
    if (busy) return { ok: false, error: busy };
    return { ok: true, op, args: { h: t.h, m: t.m, label: what } };
  }
  const busy = full();
  if (busy) return { ok: false, error: busy };
  return { ok: true, op, args: { h: t.h, m: t.m, label } };
}

/** Check, send to the tablet, and turn its answer into the tool result. */
async function run(op: TabletOp, input: Record<string, unknown>) {
  const c = check(op, input);
  if (!c.ok) return text(c.error, true);
  const a = await sendJob({ op, args: c.args });
  return text(a.data || (a.ok ? 'Done.' : 'That didn’t work on the tablet.'), !a.ok);
}

export const tabletServer = createSdkMcpServer({
  name: 'claudeos_tablet',
  version: '1.0.0',
  tools: [
    tool('set_timer',
      'Start a countdown timer in the Clock on the user’s ClaudeOS tablet; it rings when it ends. minutes: 1 to 720 (may be fractional, '
        + 'e.g. 1.5). label: optional, a few words shown when it rings. The Clock has one timer: this fails if one is already running.',
      { minutes: z.number(), label: z.string().optional() },
      async input => run('timer', input)),
    tool('set_alarm',
      'Set a one-off alarm in the Clock on the user’s ClaudeOS tablet. time: HH:MM on the 24-hour clock, in the tablet’s local time; '
        + 'the next time it comes round (today, or tomorrow if it has passed). label: optional, a few words shown when it rings.',
      { time: z.string(), label: z.string().optional() },
      async input => run('alarm', input)),
    tool('set_reminder',
      'Set a reminder on the user’s ClaudeOS tablet: at time (HH:MM, 24-hour, the next time it comes round) the Clock rings and shows text. '
        + 'Use it for “remind me at 5 to take the chicken out”. text: what to show, up to 80 characters.',
      { time: z.string(), text: z.string() },
      async input => run('reminder', input)),
    tool('notify',
      'Show a notification on the user’s ClaudeOS tablet now (a banner, kept in its notification list). '
        + 'Use it for “tell me when the build is done”. title and body: up to 80 characters each.',
      { title: z.string(), body: z.string() },
      async input => run('notify', input)),
  ],
});
