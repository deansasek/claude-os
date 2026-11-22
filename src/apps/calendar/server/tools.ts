// Claude's Calendar tool, as one in-process MCP server (claudeos_calendar) that turns.ts adds to each session.
// Read-only: today's and tomorrow's events from the calendar set in Settings > Apps > Calendar (calendar.ts).
// Each call is an ordinary tool call, so it goes through canUseTool (the approval card on the tablet) first.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { CalEvent } from '../api.ts';
import { events } from './calendar.ts';

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) });

const hm = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat([], { weekday: 'long', day: 'numeric', month: 'long' });

function row(e: CalEvent): string {
  const s = new Date(e.start), en = new Date(e.end);
  const when = e.allDay ? 'All day' : en.getTime() > s.getTime() ? `${hm.format(s)} to ${hm.format(en)}` : hm.format(s);
  return `- ${when}: ${e.title}${e.location ? ` (at ${e.location})` : ''}`;
}

export const calendarServer = createSdkMcpServer({
  name: 'claudeos_calendar',
  version: '1.0.0',
  tools: [
    tool('calendar_today',
      'Read the family calendar on the ClaudeOS tablet: today’s and tomorrow’s events with their times (local time). Read-only; '
        + 'nothing can be added or changed. day: "today", "tomorrow" or "both" (the default).',
      { day: z.enum(['today', 'tomorrow', 'both']).optional() },
      async ({ day }) => {
        const r = await events();
        if (r.status === 'not_set') return text('No calendar is set up yet. The user can add one in Settings > Apps > Calendar.');
        if (r.status === 'error') return text(`Couldn’t read the calendar: ${r.error ?? 'unknown error'}`, true);
        const now = new Date();
        const tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const parts: string[] = [];
        for (const [d, date] of [['today', now], ['tomorrow', tmr]] as const) {
          if (day && day !== 'both' && day !== d) continue;
          const list = r.events.filter(e => e.day === d);
          parts.push(`${d === 'today' ? 'Today' : 'Tomorrow'} (${dayFmt.format(date)}):\n${list.length ? list.map(row).join('\n') : '- Nothing on the calendar.'}`);
        }
        const head = `It is now ${hm.format(now)}.${r.stale ? ` (The calendar couldn’t be read just now, so this is from ${hm.format(new Date(r.fetchedAt ?? now))}.)` : ''}\n`;
        return text(head + parts.join('\n\n'));
      }),
  ],
});
