// Claude's Calendar tool, as one in-process MCP server (claudeos_calendar) that turns.ts adds to each session.
// Read-only: today's and tomorrow's events, and a range of days, from the calendar set in Settings > Apps > Calendar (calendar.ts),
// and the events the user added on the ClaudeOS calendar (local.ts), merged as the Calendar app's own reads merge them.
// Each call is an ordinary tool call, so it goes through canUseTool (the approval card on the tablet) first.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { CalEvent, CalEvents } from '../api.ts';
import { events, eventsBetween } from './calendar.ts';
import { addLocalEvent, localEventsIfReadable } from './local.ts';
import { mergeRange, withLocalDays, type RangeAnswer } from './range-merge.ts';

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) });

const hm = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat([], { weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = new Intl.DateTimeFormat([], { weekday: 'short', day: 'numeric', month: 'short' });
const NOT_SET = 'No calendar is set up yet. The user can add one in Settings > Apps > Calendar.';

function row(e: CalEvent): string {
  const s = new Date(e.start), en = new Date(e.end);
  const when = e.allDay ? 'All day' : en.getTime() > s.getTime() ? `${hm.format(s)} to ${hm.format(en)}` : hm.format(s);
  return `- ${when}: ${e.title}${e.location ? ` (at ${e.location})` : ''}`;
}

/** The calendar_today reply. The ICS events and the ClaudeOS events (local.ts) are both read; NOT_SET only when both are empty. */
export async function calendarTodayReply(
  day: 'today' | 'tomorrow' | 'both' | undefined,
  read: () => Promise<CalEvents> = events,
  local: (from: number, to: number) => ReturnType<typeof localEventsIfReadable> = localEventsIfReadable,
  now: Date = new Date(),
) {
  const ans = await read();
  const at = (add: number): number => new Date(now.getFullYear(), now.getMonth(), now.getDate() + add).getTime();
  const localDays = local(at(0), at(2));
  if (ans.status === 'not_set' && localDays !== null && !localDays.length) return text(NOT_SET);
  // the ClaudeOS events are added to the day's list; a ClaudeOS calendar that can't be read is said, not hidden
  const base: CalEvents = ans.status === 'not_set' ? { ...ans, status: 'ok', events: [] } : ans;
  const merged = localDays === null ? base : withLocalDays(base, localDays, at(0), at(1), at(2));
  // only an error with no ClaudeOS events to show is an error: the user's own events still show when the ICS calendar fails
  if (merged.status === 'error') return text(`Couldn’t read the calendar: ${ans.error ?? 'unknown error'}`, true);
  const tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const parts: string[] = [];
  for (const [d, date] of [['today', now], ['tomorrow', tmr]] as const) {
    if (day && day !== 'both' && day !== d) continue;
    const list = merged.events.filter(e => e.day === d);
    parts.push(`${d === 'today' ? 'Today' : 'Tomorrow'} (${dayFmt.format(date)}):\n${list.length ? list.map(row).join('\n') : '- Nothing on the calendar.'}`);
  }
  const unread = localDays === null ? ' (The ClaudeOS calendar couldn’t be read just now, so its events are not included.)' : '';
  // a stale answer says when it was read; a calendar that could not be read at all says so, without a made-up time
  const staleSay = merged.stale ? (merged.fetchedAt ? ` (The calendar couldn’t be read just now, so this is from ${hm.format(new Date(merged.fetchedAt))}.)` : ' (The ICS calendar couldn’t be read just now, so its events are not included.)') : '';
  const head = `It is now ${hm.format(now)}.${staleSay}${unread}
`;
  return text(head + parts.join('\n\n'));
}

/** The calendar_range reply: every event from the ICS calendar and the ClaudeOS calendar in the stretch (mergeRange, as the Calendar app merges them). */
export async function calendarRangeReply(
  args: { from?: string; days?: number },
  read: (from: number, to: number) => Promise<RangeAnswer> = (f, t) => eventsBetween(f, t),
  local: (from: number, to: number) => ReturnType<typeof localEventsIfReadable> = localEventsIfReadable,
  today: Date = new Date(),
) {
  const { from, days } = args;
  let start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (from) {
    const [y, mo, d] = from.split('-').map(Number);
    start = new Date(y, mo - 1, d);
    if (start.getFullYear() !== y || start.getMonth() !== mo - 1 || start.getDate() !== d) return text('That isn’t a real date. Give it as YYYY-MM-DD.', true);
  }
  const n = days ?? 7;
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + n);
  const localEvents = local(start.getTime(), end.getTime());
  const r = mergeRange(await read(start.getTime(), end.getTime()), localEvents ?? [], null);
  // the notes say when an answer may be out of date, or when the ClaudeOS calendar could not be read: they go on every reply, empty or not
  const notes = [r.stale ? 'The calendar couldn’t be read just now, so this may be a little out of date.' : '', localEvents === null ? 'The ClaudeOS calendar couldn’t be read just now, so its events are not included.' : ''].filter(Boolean);
  const noteText = notes.length ? `\n(${notes.join(' ')})` : '';
  // no ICS calendar and no ClaudeOS events we could read: say that, not that no calendar is set up
  if (r.status === 'not_set') return localEvents === null ? text('The ClaudeOS calendar couldn’t be read just now, so there is nothing to show.', true) : text(NOT_SET);
  if (r.status === 'error') return text(`Couldn’t read the calendar: ${r.error ?? 'unknown error'}`, true);
  if (!r.events.length) return text(`Nothing on the calendar from ${dayFmt.format(start)} for ${n} day${n === 1 ? '' : 's'}.${noteText}`);
  const lines = r.events.map(e => {
    const s = new Date(e.start), en = new Date(e.end);
    const when = e.allDay ? `${dayShort.format(s)}, all day` : `${dayShort.format(s)}, ${hm.format(s)}${en.getTime() > s.getTime() ? ` to ${hm.format(en)}` : ''}`;
    return `- ${when}: ${e.title}${e.location ? ` (at ${e.location})` : ''}`;
  });
  return text(`${r.events.length} event${r.events.length === 1 ? '' : 's'} from ${dayFmt.format(start)}:\n${lines.join('\n')}${noteText}`);
}

/** The start and end of a new ClaudeOS event: a whole day with no start or allDay, else the times on that date. Null with a reason when they don't add up. */
export function eventWindow(date: string, start?: string, end?: string, allDay?: boolean): { start: number; end: number; allDay: boolean } | { error: string } {
  const [y, mo, dd] = date.split('-').map(Number);
  const day = new Date(y, mo - 1, dd);
  if (day.getFullYear() !== y || day.getMonth() !== mo - 1 || day.getDate() !== dd) return { error: 'That isn’t a real date. Give it as YYYY-MM-DD.' };
  const at = (hhmm: string): number | null => {
    const [h, m] = hhmm.split(':').map(Number);
    return h > 23 || m > 59 ? null : new Date(y, mo - 1, dd, h, m).getTime();
  };
  if (allDay || !start) return { start: day.getTime(), end: new Date(y, mo - 1, dd + 1).getTime(), allDay: true };
  const s = at(start);
  if (s === null) return { error: 'The start time is HH:MM, 24-hour.' };
  const e = end ? at(end) : s + 3600e3;
  if (e === null) return { error: 'The end time is HH:MM, 24-hour.' };
  if (e <= s) return { error: 'The end is not after the start.' };
  return { start: s, end: e, allDay: false };
}

/** The calendar_add reply: the event goes on the ClaudeOS calendar through addLocalEvent, which checks it (checkNewEvent). */
export function calendarAddReply(
  args: { title: string; date: string; start?: string; end?: string; allDay?: boolean; location?: string },
  add: typeof addLocalEvent = addLocalEvent,
) {
  const w = eventWindow(args.date, args.start, args.end, args.allDay);
  if ('error' in w) return text(w.error, true);
  const r = add({ title: args.title, start: w.start, end: w.end, allDay: w.allDay, ...(args.location ? { location: args.location } : {}) });
  if (r.status === 'error') return text(r.error, true);
  return text(`Added “${args.title}” on ${dayFmt.format(new Date(w.start))}${w.allDay ? ', all day' : `, ${hm.format(new Date(w.start))} to ${hm.format(new Date(w.end))}`}.`);
}

export const calendarServer = createSdkMcpServer({
  name: 'claudeos_calendar',
  version: '1.0.0',
  tools: [
    tool('calendar_today',
      'Read the family calendar on the ClaudeOS tablet: today’s and tomorrow’s events with their times (local time). Read-only; '
        + 'nothing can be changed here (to add an event, use calendar_add). day: "today", "tomorrow" or "both" (the default).',
      { day: z.enum(['today', 'tomorrow', 'both']).optional() },
      ({ day }) => calendarTodayReply(day)),
    tool('calendar_range',
      'Read the family calendar on the ClaudeOS tablet for any stretch of days, e.g. next week or the 3rd to the 10th. Read-only. '
        + 'from: the first day as YYYY-MM-DD (the default is today). days: how many days, 1 to 14 (the default is 7).',
      { from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), days: z.number().int().min(1).max(14).optional() },
      (args) => calendarRangeReply(args)),
    tool('calendar_add',
      'Add an event to the ClaudeOS calendar on the tablet: the events the family adds in the Calendar app (not the ICS calendar). '
        + 'title; date as YYYY-MM-DD; start and end as HH:MM (24-hour), or allDay for a whole day; location is optional. '
        + 'Use it when the user asks to put something on the calendar.',
      {
        title: z.string().min(1).max(80),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        allDay: z.boolean().optional(),
        location: z.string().max(80).optional(),
      },
      async (args) => calendarAddReply(args)),
  ],
});
