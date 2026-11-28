// Claude's Calendar tool, as one in-process MCP server (claudeos_calendar) that turns.ts adds to each session.
// Read-only: today's and tomorrow's events, and a range of days, from the calendar set in Settings > Apps > Calendar (calendar.ts),
// and the events the user added on the ClaudeOS calendar (local.ts), merged as the Calendar app's own reads merge them.
// Each call is an ordinary tool call, so it goes through canUseTool (the approval card on the tablet) first.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { CalEvent, CalEvents } from '../api.ts';
import { events, eventsBetween } from './calendar.ts';
import { localEventsIfReadable } from './local.ts';
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
  if (ans.status === 'error') return text(`Couldn’t read the calendar: ${ans.error ?? 'unknown error'}`, true);
  // the ClaudeOS events are added to the day's list; a ClaudeOS calendar that can't be read is said, not hidden
  const base: CalEvents = ans.status === 'not_set' ? { ...ans, status: 'ok', events: [] } : ans;
  const merged = localDays === null ? base : withLocalDays(base, localDays, at(0), at(1), at(2));
  const tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const parts: string[] = [];
  for (const [d, date] of [['today', now], ['tomorrow', tmr]] as const) {
    if (day && day !== 'both' && day !== d) continue;
    const list = merged.events.filter(e => e.day === d);
    parts.push(`${d === 'today' ? 'Today' : 'Tomorrow'} (${dayFmt.format(date)}):\n${list.length ? list.map(row).join('\n') : '- Nothing on the calendar.'}`);
  }
  const unread = localDays === null ? ' (The ClaudeOS calendar couldn’t be read just now, so its events are not included.)' : '';
  const head = `It is now ${hm.format(now)}.${merged.stale ? ` (The calendar couldn’t be read just now, so this is from ${hm.format(new Date(merged.fetchedAt ?? now))}.)` : ''}${unread}\n`;
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
  if (r.status === 'not_set') return text(NOT_SET);
  if (r.status === 'error') return text(`Couldn’t read the calendar: ${r.error ?? 'unknown error'}`, true);
  if (!r.events.length) return text(`Nothing on the calendar from ${dayFmt.format(start)} for ${n} day${n === 1 ? '' : 's'}.`);
  const lines = r.events.map(e => {
    const s = new Date(e.start), en = new Date(e.end);
    const when = e.allDay ? `${dayShort.format(s)}, all day` : `${dayShort.format(s)}, ${hm.format(s)}${en.getTime() > s.getTime() ? ` to ${hm.format(en)}` : ''}`;
    return `- ${when}: ${e.title}${e.location ? ` (at ${e.location})` : ''}`;
  });
  const notes = [r.stale ? 'The calendar couldn’t be read just now, so this may be a little out of date.' : '', localEvents === null ? 'The ClaudeOS calendar couldn’t be read just now, so its events are not included.' : ''].filter(Boolean);
  return text(`${r.events.length} event${r.events.length === 1 ? '' : 's'} from ${dayFmt.format(start)}:\n${lines.join('\n')}${notes.length ? `\n(${notes.join(' ')})` : ''}`);
}

export const calendarServer = createSdkMcpServer({
  name: 'claudeos_calendar',
  version: '1.0.0',
  tools: [
    tool('calendar_today',
      'Read the family calendar on the ClaudeOS tablet: today’s and tomorrow’s events with their times (local time). Read-only; '
        + 'nothing can be added or changed. day: "today", "tomorrow" or "both" (the default).',
      { day: z.enum(['today', 'tomorrow', 'both']).optional() },
      ({ day }) => calendarTodayReply(day)),
    tool('calendar_range',
      'Read the family calendar on the ClaudeOS tablet for any stretch of days, e.g. next week or the 3rd to the 10th. Read-only. '
        + 'from: the first day as YYYY-MM-DD (the default is today). days: how many days, 1 to 14 (the default is 7).',
      { from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), days: z.number().int().min(1).max(14).optional() },
      (args) => calendarRangeReply(args)),
  ],
});
