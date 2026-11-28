// The Meals count of planned nights (src/apps/meals/web/week.ts plannedWords, and its line in the editor, index.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dinnersIn, plannedWords, weekDays } from '../src/apps/meals/web/week.ts';

const days = weekDays(new Date(2026, 10, 23));
const dinner = (i: number) => ({ id: `d${i}`, title: `Dinner: Meal ${i}`, start: days[i].start, allDay: true });

test('the count says how many of the week’s nights have a dinner', () => {
  assert.equal(plannedWords(days, []), '0 of 7 dinners planned');
  assert.equal(plannedWords(days, dinnersIn([dinner(0), dinner(2), dinner(4), dinner(5), dinner(6)])), '5 of 7 dinners planned');
  assert.equal(plannedWords(days, dinnersIn(days.map((_, i) => dinner(i)))), 'All 7 dinners planned');
});

test('the Meals editor shows the count under the week’s range', () => {
  const src = readFileSync(new URL('../src/apps/meals/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const html = readFileSync(new URL('../src/apps/meals/view.html', import.meta.url), 'utf8');
  assert.match(html, /id="mpCount"/);
  assert.match(src, /c\.\$\('mpCount'\)\.textContent = plannedWords\(days, dinners\);/);
});
