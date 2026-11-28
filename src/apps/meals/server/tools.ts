// Claude's Meals tool, as one in-process MCP server (claudeos_meals) that turns.ts adds to each session.
// Read-only: the week's planned dinners, read from the ClaudeOS calendar where the Meals app saves them (week.ts).
// Each call is an ordinary tool call, so it goes through canUseTool (the approval card on the tablet) first.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { localEventsIfReadable } from '../../calendar/server/local.ts';
import { dinnersIn, mondayOf, weekDays } from '../web/week.ts';

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) });
const dayName = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });

/** The meals_week reply: one line per night, Monday to Sunday. week 0 is this week, 1 the next. read defaults to the local calendar. */
export function mealsWeekReply(week: number, now: Date = new Date(), read: typeof localEventsIfReadable = localEventsIfReadable) {
  const monday = mondayOf(now);
  const days = weekDays(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7 * week));
  const events = read(days[0].start, days[6].end);
  if (!events) return text('The dinner plan couldn’t be read just now.', true);
  const dinners = dinnersIn(events);
  return text(days.map(d => {
    const dinner = dinners.find(x => x.start >= d.start && x.start < d.end);
    return `${dayName.format(d.date)}: ${dinner ? dinner.text : 'No dinner planned'}`;
  }).join('\n'));
}

export const mealsServer = createSdkMcpServer({
  name: 'claudeos_meals',
  version: '1.0.0',
  tools: [
    tool('meals_week',
      'Read the dinners planned for a week on the ClaudeOS Meals app, one line per night, Monday to Sunday. Read-only. '
        + 'week: 0 for this week (the default) or 1 for next week.',
      { week: z.number().int().min(0).max(1).optional() },
      async ({ week }) => mealsWeekReply(week ?? 0)),
  ],
});
