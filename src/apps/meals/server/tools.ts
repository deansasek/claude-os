// Claude's Meals tools, as one in-process MCP server (claudeos_meals) that turns.ts adds to each session.
// meals_week is read-only: the week's planned dinners, read from the ClaudeOS calendar where the Meals app saves them (week.ts).
// meals_plan writes one night's dinner on that calendar, the same way the Meals page does (replacing the one already set).
// Each call is an ordinary tool call, so it goes through canUseTool (the approval card on the tablet) first.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { addLocalEvent, localEventsIfReadable, updateLocalEvent } from '../../calendar/server/local.ts';
import { DINNER, dinnerTitle, dinnersIn, mondayOf, weekDays } from '../web/week.ts';

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

/**
 * The meals_plan reply. day is a weekday name ("Thursday") or a date ("2026-12-03") in the week chosen by week (0 this week, 1 next).
 * The dinner set for that night is changed; if there is none, a new all-day dinner is added. The calendar functions are the Meals page's.
 */
export function mealsPlanReply(
  { day, dinner, week }: { day: string; dinner: string; week?: number },
  now: Date = new Date(),
  read: typeof localEventsIfReadable = localEventsIfReadable,
  add: typeof addLocalEvent = addLocalEvent,
  update: typeof updateLocalEvent = updateLocalEvent,
) {
  if (!dinner.trim()) return text('Say what the dinner is.', true);
  const monday = mondayOf(now);
  const want = day.trim().toLowerCase();
  // a date picks its own week (this week or next); a weekday name is looked for in the week set by week
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(want);
  const weeks = iso ? [0, 1] : [week ?? 0];
  const days = weeks.flatMap(w => weekDays(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7 * w)));
  const target = days.find(d => d.iso === want || dayName.format(d.date).toLowerCase() === want);
  if (!target) return text(iso ? `Meals plans this week and next only, so ${day} is outside them.` : `There’s no day “${day}” in that week. Use a weekday name, or a date such as 2026-12-03.`, true);
  const events = read(days[0].start, days[days.length - 1].end);
  if (!events) return text('The dinner plan couldn’t be read just now, so nothing was changed.', true);
  const existing = dinnersIn(events).find(x => x.start >= target.start && x.start < target.end);
  const title = dinnerTitle(dinner);
  const r = existing
    ? update({ id: existing.id, title })
    : add({ title, start: target.start, end: target.end, allDay: true });
  if (r.status === 'error') return text(r.error, true);
  return text(`${existing ? 'Changed' : 'Planned'} ${dayName.format(target.date)}’s dinner: ${title.slice(DINNER.length)}.`);
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
    tool('meals_plan',
      'Plan the dinner for one night on the ClaudeOS Meals app. It replaces the dinner already set for that night. '
        + 'day: a weekday name ("Thursday") in the week set by week, or a date ("2026-12-03") this week or next. dinner: the dish, e.g. "lasagne". '
        + 'week: 0 for this week (the default) or 1 for next week.',
      {
        day: z.string().min(1).max(40),
        dinner: z.string().min(1).max(120),
        week: z.number().int().min(0).max(1).optional(),
      },
      async (args) => mealsPlanReply(args)),
  ],
});
