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

/** Repeat days from a tool call: 0 (Sunday) to 6 (Saturday), sorted and unique. None means once only. */
function daysFrom(v: unknown): number[] | { error: string } {
  if (v == null) return [];
  if (!Array.isArray(v)) return { error: 'The days must be a list of numbers, like [1, 2, 3, 4, 5] for weekdays.' };
  const days = [...new Set(v)];
  if (days.some(d => typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6)) return { error: 'The days are numbers from 0 (Sunday) to 6 (Saturday).' };
  return (days as number[]).sort((a, b) => a - b);
}

/** Check a tool's arguments; the error is a plain sentence for Claude. */
export function check(op: TabletOp, input: Record<string, unknown>): Checked {
  // the Clock's status and cancels take no arguments; they run on the tablet, where the Clock's state is
  if (op === 'cancel_timer' || op === 'pause_timer' || op === 'resume_timer') return { ok: true, op, args: { label: cleanText(input.label) } };
  // whole minutes, added (plus) or taken off (minus), and not zero; the Clock caps the change too (nudgeTimer)
  if (op === 'adjust_timer') {
    const m = input.minutes;
    if (typeof m !== 'number' || !Number.isInteger(m) || m === 0 || Math.abs(m) > 60) return { ok: false, error: 'The change is whole minutes, from -60 to 60, and not zero.' };
    return { ok: true, op, args: { minutes: m, label: cleanText(input.label) } };
  }   // a timer by its name, or the one in front
  if (op === 'clock_status' || op === 'cancel_alarms' || op === 'tablet_status' || op === 'list_alarms') return { ok: true, op, args: {} };
  // read the volume (no input), or set a level from 0 to 100, or step it up or down, mute or unmute: one of those, not both
  // the screen's mode (light, dark, time or system); with none, the tool only reads it
  if (op === 'theme') {
    if (input.mode === undefined) return { ok: true, op, args: {} };
    return typeof input.mode === 'string' && ['light', 'dark', 'time', 'system'].includes(input.mode) ? { ok: true, op, args: { mode: input.mode } } : { ok: false, error: 'The mode is light, dark, time or system.' };
  }
  if (op === 'volume') {
    const hasLevel = typeof input.level === 'number', act = input.action;
    if (hasLevel && typeof act === 'string') return { ok: false, error: 'Give a level or an action, not both.' };
    if (hasLevel) {
      const lv = input.level as number;
      if (!Number.isInteger(lv) || lv < 0 || lv > 100) return { ok: false, error: 'The level is a whole number from 0 to 100.' };
      return { ok: true, op, args: { level: lv } };
    }
    if (typeof act === 'string') return ['up', 'down', 'mute', 'unmute'].includes(act) ? { ok: true, op, args: { action: act } } : { ok: false, error: 'The action is up, down, mute or unmute.' };
    return { ok: true, op, args: {} };
  }
  if (op === 'dnd') return typeof input.on === 'boolean' ? { ok: true, op, args: { on: input.on } } : { ok: false, error: 'Say whether Do Not Disturb is on or off.' };
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
  const days = daysFrom(input.days);
  if (!Array.isArray(days)) return { ok: false, error: days.error };
  if (op === 'reminder') {
    const what = cleanText(input.text);
    if (!what) return { ok: false, error: 'The reminder needs some text to show, like “Take the chicken out”.' };
    const busy = full();
    if (busy) return { ok: false, error: busy };
    return { ok: true, op, args: { h: t.h, m: t.m, label: what, days } };
  }
  const busy = full();
  if (busy) return { ok: false, error: busy };
  return { ok: true, op, args: { h: t.h, m: t.m, label, days } };
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
        + 'e.g. 1.5). label: optional, a few words shown when it rings. The Clock keeps a list of timers, each with its own label: this fails only when the list is full.',
      { minutes: z.number().min(MIN_MINUTES).max(MAX_MINUTES), label: z.string().optional() },
      async input => run('timer', input)),
    tool('set_alarm',
      'Set an alarm in the Clock on the user’s ClaudeOS tablet. time: HH:MM on the 24-hour clock, in the tablet’s local time. '
        + 'days: leave out for one time only (it rings today, or tomorrow if that time has passed); give days to repeat it, e.g. [1,2,3,4,5] every weekday. '
        + 'label: optional, a few words shown when it rings.',
      { time: z.string(), label: z.string().optional(), days: z.array(z.number().int().min(0).max(6)).max(7).optional().describe('Repeat on these days: 0 = Sunday … 6 = Saturday, e.g. [1,2,3,4,5] for weekdays. Leave out for one time only.') },
      async input => run('alarm', input)),
    tool('set_reminder',
      'Set a reminder on the user’s ClaudeOS tablet: at time (HH:MM, 24-hour; one time only, or repeat it with days) the Clock rings and shows text. '
        + 'Use it for “remind me at 5 to take the chicken out”. text: what to show, up to 80 characters.',
      { time: z.string(), text: z.string(), days: z.array(z.number().int().min(0).max(6)).max(7).optional().describe('Repeat on these days: 0 = Sunday … 6 = Saturday, e.g. [1,2,3,4,5] for weekdays. Leave out for one time only.') },
      async input => run('reminder', input)),
    tool('notify',
      'Show a notification on the user’s ClaudeOS tablet now (a banner, kept in its notification list). '
        + 'Use it for “tell me when the build is done”. title: up to 80 characters; body: optional, up to 80 characters. A title alone is enough.',
      { title: z.string(), body: z.string().optional() },
      async input => run('notify', input)),
    tool('tablet_status',
      'Read the ClaudeOS tablet’s battery (the charge, and whether it is charging), the Wi-Fi it is on, and whether Do Not Disturb is on. Read-only.',
      {},
      async () => run('tablet_status', {})),
    tool('clock_status',
      'Read the ClaudeOS tablet’s Clock: whether a timer is running and how long is left (and whether it is paused), the names of the named timers with their time left, '
        + 'when the next alarm rings, how many timers and alarms are on, and the stopwatch’s time and whether it runs. Read-only.',
      {},
      async () => run('clock_status', {})),
    tool('pause_timer',
      'Pause a timer on the user’s ClaudeOS tablet. label: optional, the timer’s name when several are set; with none, the timer in front is paused. '
        + 'The time left is kept, and resume_timer starts it again. Use it when the user says to pause a timer.',
      { label: z.string().optional() },
      async ({ label }) => run('pause_timer', label ? { label } : {})),
    tool('adjust_timer',
      'Add minutes to a timer on the user’s ClaudeOS tablet, or take minutes off it. label: optional, the timer’s name when several are set; with none, the timer in front. minutes: whole minutes from -60 to 60; '
        + 'a minus takes minutes off. Use it when the user says to add to or cut back a timer.',
      { minutes: z.number().int().min(-60).max(60), label: z.string().optional() },
      async ({ minutes, label }) => run('adjust_timer', label ? { minutes, label } : { minutes })),
    tool('resume_timer',
      'Resume a paused timer on the user’s ClaudeOS tablet, from where it stopped. label: optional, the timer’s name when several are set; '
        + 'with none, the paused timer is resumed. Use it when the user says to start a paused timer again.',
      { label: z.string().optional() },
      async ({ label }) => run('resume_timer', label ? { label } : {})),
    tool('cancel_timer',
      'Cancel a timer on the user’s ClaudeOS tablet. label: optional, the timer’s name when several are set (as set_timer gave it); with none, the timer in front is cancelled. Use it when the user says to stop or cancel a timer.',
      { label: z.string().optional() },
      async ({ label }) => run('cancel_timer', label ? { label } : {})),
    tool('set_theme',
      'Read or set the screen’s mode on the user’s ClaudeOS tablet: light, dark, time (automatic, by the time of day) or system (automatic, following the tablet). '
        + 'With no mode it says the current mode. Use it when the user asks for dark mode, light mode, or automatic.',
      { mode: z.enum(['light', 'dark', 'time', 'system']).optional() },
      async ({ mode }) => run('theme', mode ? { mode } : {})),
    tool('set_volume',
      'Read or set the media volume on the user’s ClaudeOS tablet. With no input it says the volume. level: a volume from 0 to 100. '
        + 'action: up or down a step, mute or unmute, instead of a level. Use it when the user asks to turn the sound up, down or off, or to set it.',
      { level: z.number().int().min(0).max(100).optional(), action: z.enum(['up', 'down', 'mute', 'unmute']).optional() },
      async ({ level, action }) => run('volume', level !== undefined ? { level } : action ? { action } : {})),
    tool('set_dnd',
      'Turn Do Not Disturb on or off on the user’s ClaudeOS tablet. On: no banners show, but notifications still go to the list. Use it when the user asks to silence the tablet or to turn its sound and banners back on.',
      { on: z.boolean() },
      async ({ on }) => run('dnd', { on })),
    tool('list_alarms',
      'List the alarms that are on in the Clock on the ClaudeOS tablet, soonest first, with their times and days. Read-only. It gives the times, not the names.',
      {},
      async () => run('list_alarms', {})),
    tool('cancel_alarms',
      'Switch off the alarms and reminders you set on the user’s ClaudeOS tablet (set_alarm, set_reminder). It keeps the user’s own alarms '
        + 'and does not delete anything; they can be turned on again in the Clock.',
      {},
      async () => run('cancel_alarms', {})),
  ],
});
