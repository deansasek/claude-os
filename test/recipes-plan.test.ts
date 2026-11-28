// "Plan this" on a recipe puts it on a free night of this week as a Meals dinner (src/apps/recipes/web/index.ts). The page is
// DOM code, so this reads its source: the button, the picker, the calendar read and write, and that taken nights cannot be picked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/recipes/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the recipe page has a Plan this button, and the picker lists the week’s nights', () => {
  assert.match(src, /data-act="plan">Plan this</);
  assert.match(src, /case 'plan': if \(screen\.t === 'detail'\) \{ planWeek = 0; void openPlan\(\); \} break;/);
  assert.match(src, /`\/api\/calendar\/local\?from=\$\{from\}&to=\$\{to\}`, PLAN_TIMEOUT_MS/);
});

test('a free night saves the recipe as an all-day dinner, and a taken night cannot be picked', () => {
  assert.match(src, /postJson<\{ error\?: string \}>\('\/api\/calendar\/local-add',\s*\{ title: dinnerTitle\(screen\.r\.name\), start: day\.start, end: day\.end, allDay: true \}/);
  assert.match(src, /if \(!day \|\| planTaken === null \|\| dinnerOn\(planTaken, day\)\) return;/);
  assert.match(src, /<button class="rc-plan-row" disabled>/);
});

test('a switch to another recipe closes the picker', () => {
  assert.match(src, /if \(scaleKey !== key\) \{ scaleKey = key; servings = base \?\? 0; planning = false; \}/);
});
