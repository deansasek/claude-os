// Claude's meals_plan tool plans one night's dinner on the ClaudeOS calendar (src/apps/meals/server/tools.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { mealsPlanReply } from '../src/apps/meals/server/tools.ts';
import { dinnerTitle, mondayOf, weekDays } from '../src/apps/meals/web/week.ts';

// Saturday 28 November 2026: this week is Monday 23 to Sunday 29; Thursday is days[3]
const now = new Date(2026, 10, 28, 9, 0);
const days = weekDays(mondayOf(now));
const thu = days[3];

function fakes(existing: { id: string; title: string; start: number }[] = []) {
  const calls: { op: string; input: any }[] = [];
  return {
    calls,
    read: () => existing.map(e => ({ ...e, end: e.start + 86400e3, allDay: true })) as never,
    add: (input: any) => { calls.push({ op: 'add', input }); return { status: 'ok', event: input } as never; },
    update: (input: any) => { calls.push({ op: 'update', input }); return { status: 'ok', event: input } as never; },
  };
}

test('a night with no dinner gets a new all-day dinner for that day', () => {
  const f = fakes();
  const r = mealsPlanReply({ day: 'Thursday', dinner: 'lasagne' }, now, f.read, f.add as never, f.update as never);
  assert.equal(r.isError, undefined);
  assert.equal(r.content[0].text, 'Planned Thursday’s dinner: lasagne.');
  assert.deepEqual(f.calls, [{ op: 'add', input: { title: dinnerTitle('lasagne'), start: thu.start, end: thu.end, allDay: true } }]);
});

test('a night with a dinner already set changes that dinner, not a second one', () => {
  const f = fakes([{ id: 'd1', title: dinnerTitle('Tacos'), start: thu.start }]);
  const r = mealsPlanReply({ day: 'thursday', dinner: 'Curry' }, now, f.read, f.add as never, f.update as never);
  assert.equal(r.content[0].text, 'Changed Thursday’s dinner: Curry.');
  assert.deepEqual(f.calls, [{ op: 'update', input: { id: 'd1', title: dinnerTitle('Curry') } }]);
});

test('a date in the week works as well as a weekday name', () => {
  const f = fakes();
  mealsPlanReply({ day: '2026-11-26', dinner: 'soup' }, now, f.read, f.add as never, f.update as never);
  assert.equal(f.calls[0].input.start, thu.start);
});

test('next week is chosen with week 1', () => {
  const f = fakes();
  mealsPlanReply({ day: 'Monday', dinner: 'pasta', week: 1 }, now, f.read, f.add as never, f.update as never);
  assert.equal(f.calls[0].input.start, days[0].start + 7 * 86400e3);
});

test('a day that is not in the week, or an empty dish, changes nothing and says so', () => {
  const f = fakes();
  const bad = mealsPlanReply({ day: 'Funday', dinner: 'pasta' }, now, f.read, f.add as never, f.update as never);
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /no day “Funday”/);
  const empty = mealsPlanReply({ day: 'Monday', dinner: '  ' }, now, f.read, f.add as never, f.update as never);
  assert.equal(empty.isError, true);
  assert.equal(f.calls.length, 0);
});

test('an unreadable calendar is not written to', () => {
  const f = fakes();
  const r = mealsPlanReply({ day: 'Monday', dinner: 'pasta' }, now, () => null, f.add as never, f.update as never);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /nothing was changed/);
  assert.equal(f.calls.length, 0);
});

test('the tool is wired into each session, and its card has plain words and detail', () => {
  const turns = readFileSync(new URL('../src/apps/claude/server/turns.ts', import.meta.url), 'utf8');
  const cards = readFileSync(new URL('../src/apps/claude/web/tools.ts', import.meta.url), 'utf8');
  const describe = readFileSync(new URL('../src/apps/claude/server/describe.ts', import.meta.url), 'utf8');
  assert.ok(turns.includes('claudeos_meals: mealsServer'));
  assert.ok(cards.includes("'mcp__claudeos_meals__meals_plan': { now: 'Plan a dinner', past: 'Planned a dinner', doing: 'Planning a dinner' },"));
  assert.ok(describe.includes("if (n === 'meals_plan' && typeof i.day === 'string' && typeof i.dinner === 'string') return `${i.day}: ${i.dinner}`;"));
});

test('a date next week is planned without week, and a date past next week is refused', () => {
  const calls: any[] = [];
  const ok = mealsPlanReply({ day: '2026-12-01', dinner: 'curry' }, now, () => [] as never, ((input: any) => { calls.push(input); return { status: 'ok', event: input }; }) as never, (() => ({ status: 'ok' })) as never);
  assert.match(ok.content[0].text, /^Planned Tuesday/);
  assert.equal(calls[0].start, new Date(2026, 11, 1).getTime());
  const late = mealsPlanReply({ day: '2026-12-20', dinner: 'curry' }, now, () => [] as never, (() => ({ status: 'ok' })) as never, (() => ({ status: 'ok' })) as never);
  assert.equal(late.isError, true);
  assert.match(late.content[0].text, /this week and next only/);
});
