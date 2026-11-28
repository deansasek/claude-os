// "Plan this" can plan next week too (src/apps/recipes/web/index.ts, src/apps/meals/web/week.ts mondayAfter).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isoDay, mondayAfter, weekDays } from '../src/apps/meals/web/week.ts';

test('next week starts the Monday after this one, and its seven nights run to the Sunday', () => {
  const wed = new Date(2026, 10, 25);                    // Wednesday 25 November 2026
  assert.equal(isoDay(mondayAfter(wed, 0)), '2026-11-23');
  assert.equal(isoDay(mondayAfter(wed, 1)), '2026-11-30');
  const next = weekDays(mondayAfter(wed, 1));
  assert.equal(next[0].iso, '2026-11-30');
  assert.equal(next[6].iso, '2026-12-06');
});

test('the Sunday is in the week it ends, even on a Sunday', () => {
  const sun = new Date(2026, 10, 29);
  assert.equal(isoDay(mondayAfter(sun, 0)), '2026-11-23');
  assert.equal(isoDay(mondayAfter(sun, 1)), '2026-11-30');
});

test('the Plan panel has This week and Next week, and the next week is read from its own Monday', () => {
  const src = readFileSync(new URL('../src/apps/recipes/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /data-act="plan-week" data-w="0">This week/);
  assert.match(src, /data-act="plan-week" data-w="1">Next week/);
  assert.match(src, /planDays = weekDays\(mondayAfter\(new Date\(\), planWeek\)\);/);
  assert.match(src, /case 'plan-week': planWeek = b\.dataset\.w === '1' \? 1 : 0; void openPlan\(\); break;/);
});
