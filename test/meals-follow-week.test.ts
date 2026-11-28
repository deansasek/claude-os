// Meals follows the new week after midnight on Monday, unless the user moved to another week (src/apps/meals/web/week.ts).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { followedWeekMonday } from '../src/apps/meals/web/week.ts';

const day = (y: number, m: number, d: number): Date => new Date(y, m, d);
// 23 November 2026 is a Monday
const monday23 = day(2026, 10, 23);
const monday30 = day(2026, 10, 30);

test('a new week is followed when the view still sits on the week the clock was on', () => {
  const next = followedWeekMonday(monday23, monday23, day(2026, 10, 30));
  assert.equal(next.getTime(), monday30.getTime());
});

test('a week the user moved to stays put, even when the clock has moved on', () => {
  assert.equal(followedWeekMonday(monday30, monday23, day(2026, 10, 30)).getTime(), monday30.getTime());
});

test('the same week is kept while the clock is still in it', () => {
  assert.equal(followedWeekMonday(monday23, monday23, day(2026, 10, 26)).getTime(), monday23.getTime());
});

test('Meals calls the rule from onShow, and remembers the week it followed', () => {
  const src = readFileSync(new URL('../src/apps/meals/web/index.ts', import.meta.url), 'utf8');
  assert.ok(src.includes('const next = followedWeekMonday(monday, lastMonday, new Date());'));
  assert.ok(src.includes('lastMonday = mondayOf(new Date());'));
});
