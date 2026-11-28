// Copy last week's dinners into this week's free nights (src/apps/meals/web/week.ts copyPlan, and the button in index.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { copyPlan, dinnerTitle, dinnersIn, mondayAfter, weekDays } from '../src/apps/meals/web/week.ts';

const thisWeek = weekDays(mondayAfter(new Date(2026, 10, 25), 0));    // the week of 23 November
const lastWeek = weekDays(mondayAfter(new Date(2026, 10, 25), -1));   // the week of 16 November

test('each free night takes the dinner from the same weekday last week', () => {
  const last = dinnersIn([
    { id: 'a', title: 'Dinner: Tacos', start: lastWeek[1].start, allDay: true },   // Tuesday
    { id: 'b', title: 'Dinner: Pasta', start: lastWeek[4].start, allDay: true },   // Friday
  ]);
  const plan = copyPlan(thisWeek, lastWeek, [], last);
  assert.deepEqual(plan, [
    { i: 1, title: dinnerTitle('Tacos'), start: thisWeek[1].start, end: thisWeek[1].end },
    { i: 4, title: dinnerTitle('Pasta'), start: thisWeek[4].start, end: thisWeek[4].end },
  ]);
});

test('a night that already has a dinner is kept, and an empty last week copies nothing', () => {
  const last = dinnersIn([{ id: 'a', title: 'Dinner: Tacos', start: lastWeek[1].start, allDay: true }]);
  const now = dinnersIn([{ id: 'c', title: 'Dinner: Soup', start: thisWeek[1].start, allDay: true }]);
  assert.deepEqual(copyPlan(thisWeek, lastWeek, now, last), []);
  assert.deepEqual(copyPlan(thisWeek, lastWeek, [], []), []);
});

test('the Meals editor reads last week and writes each dinner with the calendar routes', () => {
  const src = readFileSync(new URL('../src/apps/meals/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const html = readFileSync(new URL('../src/apps/meals/view.html', import.meta.url), 'utf8');
  assert.match(html, /id="mpCopy"/);
  assert.match(src, /c\.\$\('mpCopy'\)\.addEventListener\('click', \(\) => void copyLastWeek\(c\)\);/);
  assert.match(src, /mondayAfter\(days\[0\]\.date, -1\)/);
  assert.match(src, /`\$\{API\}\/local-add`, \{ title: p\.title, start: p\.start, end: p\.end, allDay: true \}/);
});
