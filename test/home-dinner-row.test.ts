// Home's Dinner row words (src/apps/home/web/dinner-row.ts) and its wiring in Home (src/apps/home/web/index.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dinnerRow } from '../src/apps/home/web/dinner-row.ts';

test('the row shows tonight’s dinner, or Nothing planned', () => {
  assert.deepEqual(dinnerRow('Tacos', 'ok', false), { val: 'Tacos', sub: 'Tonight' });
  assert.deepEqual(dinnerRow(null, 'ok', false), { val: 'Nothing planned', sub: '' });
});

test('the row says it is loading, or that the calendar cannot be reached, and marks an old dinner offline', () => {
  assert.equal(dinnerRow(null, 'loading', false).val, 'Loading…');
  assert.equal(dinnerRow(null, 'failed', false).val, 'Can’t reach the calendar');
  assert.deepEqual(dinnerRow('Tacos', 'failed', true), { val: 'Tacos', sub: 'Offline · Tonight' });
});

test('Home reads today’s calendar events, opens Meals on a tap, and paints the row', () => {
  const src = readFileSync(new URL('../src/apps/home/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const html = readFileSync(new URL('../src/apps/home/view.html', import.meta.url), 'utf8');
  assert.match(src, /`\/api\/calendar\/local\?from=\$\{from\}&to=\$\{to\}`, DINNER_TIMEOUT_MS/);
  assert.match(src, /if \(seq !== dinnerSeq\) return;/);
  assert.match(html, /data-go="meals"[\s\S]*id="hmDnVal"/);
});
