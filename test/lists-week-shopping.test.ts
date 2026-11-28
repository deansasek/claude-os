// This week's dinners on the Shopping list, from Lists (src/apps/lists/web/index.ts addWeek). The Lists page is DOM code, so this
// reads its source; the shared logic is in src/apps/meals/web/week-shopping.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p: string): string => readFileSync(new URL(`../src/apps/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('Lists has a This week’s dinners button, shown on the Shopping list only', () => {
  const html = read('lists/view.html');
  const src = read('lists/web/index.ts');
  assert.match(html, /id="lsWeek" hidden>This week’s dinners</);
  assert.match(src, /\$\('lsWeek'\)\.hidden = l\.id !== 'shopping';/);
  assert.match(src, /\$\('lsWeek'\)\.addEventListener\('click', \(\) => void addWeek\(\)\);/);
});

test('the button reads the week and adds it through the same shared logic as Meals', () => {
  const src = read('lists/web/index.ts');
  const shared = read('meals/web/week-shopping.ts');
  assert.match(src, /dinners = await weekDinners\(\);/);
  assert.match(src, /note = await addDinnersToShopping\(dinners\);/);
  assert.match(shared, /export async function weekDinners\(/);
  assert.match(shared, /export async function addDinnersToShopping\(/);
});
