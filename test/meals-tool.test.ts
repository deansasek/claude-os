// Claude's meals_week tool reads the week's dinners from the ClaudeOS calendar (src/apps/meals/server/tools.ts).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { mealsWeekReply } from '../src/apps/meals/server/tools.ts';
import { dinnerTitle, weekDays, mondayOf } from '../src/apps/meals/web/week.ts';

// Saturday 28 November 2026: the week is Monday 23 to Sunday 29
const now = new Date(2026, 10, 28, 9, 0);
const days = weekDays(mondayOf(now));

test('each night of the week shows its dinner, or that none is planned', () => {
  const wed = days[2];
  const events = [{ id: 'd1', title: dinnerTitle('Tacos'), start: wed.start + 18 * 3600e3, end: wed.start + 19 * 3600e3, allDay: false }];
  const r = mealsWeekReply(0, now, () => events as never);
  const lines = r.content[0].text.split('\n');
  assert.equal(lines.length, 7);
  assert.equal(lines[2], 'Wednesday: Tacos');
  assert.equal(lines[0], 'Monday: No dinner planned');
});

test('a calendar that cannot be read says so, plainly', () => {
  const r = mealsWeekReply(0, now, () => null);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /couldn’t be read/);
});

test('the tool is wired into each session, and its approval card has plain words', () => {
  const turns = readFileSync(new URL('../src/apps/claude/server/turns.ts', import.meta.url), 'utf8');
  const cards = readFileSync(new URL('../src/apps/claude/web/tools.ts', import.meta.url), 'utf8');
  assert.ok(turns.includes('claudeos_meals: mealsServer'));
  assert.ok(cards.includes("'mcp__claudeos_meals__meals_week': { now: 'Look at the dinner plan', past: 'Looked at the dinner plan', doing: 'Looking at the dinner plan' },"));
});
