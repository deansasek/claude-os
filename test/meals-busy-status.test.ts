// Meals shows a working line while Remove, Copy last week and Add this week's shopping run (src/apps/meals/web/index.ts).
// The page is DOM code, so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('each long action sets its status line once it starts', () => {
  const src = readFileSync(new URL('../src/apps/meals/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const after = (head: string): string => src.slice(src.indexOf(head), src.indexOf(head) + 240);
  assert.match(after('async function remove(c: AppContext, i: number)'), /busy = true;\s*setStatus\(c, 'Removing…'\);/);
  assert.match(after('async function copyLastWeek(c: AppContext)'), /busy = true;\s*setStatus\(c, 'Copying last week…'\);/);
  assert.match(after('async function addWeekShopping(c: AppContext)'), /busy = true;\s*setStatus\(c, 'Adding to Shopping…'\);/);
});
