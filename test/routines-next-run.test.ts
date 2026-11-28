// The next routine that runs by itself (src/apps/routines/web/next-run.ts), and Home's Next routine row (src/apps/home/web/index.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { nextRun, nextRunWords } from '../src/apps/routines/web/next-run.ts';

const at = (h: number, m: number, days: number[] = []) => ({ h, m, days });
// Wednesday 25 November 2026, 10:00
const now = new Date(2026, 10, 25, 10, 0);

test('the next run is the earliest time after now, today or later', () => {
  const next = nextRun([{ name: 'Bedtime', at: at(20, 0) }, { name: 'Morning', at: at(7, 0) }], now);
  assert.equal(next?.name, 'Bedtime');
  assert.equal(next?.at.getHours(), 20);
  assert.equal(nextRun([{ name: 'Morning', at: at(7, 0) }], now)?.at.getDate(), 26);
});

test('a routine with days runs only on those days, and no time set is never next', () => {
  const weekend = nextRun([{ name: 'Walk', at: at(9, 0, [6, 0]) }], now);   // Saturday and Sunday
  assert.equal(weekend?.at.getDay() === 6 || weekend?.at.getDay() === 0, true);
  assert.equal(nextRun([{ name: 'Plain' }], now), null);
  assert.equal(nextRun([], now), null);
});

test('the row says the routine and when it runs', () => {
  const next = nextRun([{ name: 'Bedtime', at: at(20, 0) }], now);
  assert.equal(nextRunWords(next, now).val, 'Bedtime');
  assert.match(nextRunWords(next, now).sub, /^Today /);
  assert.equal(nextRunWords(null, now).val, 'None set');
});

test('Home reads the routine list and paints the row', () => {
  const src = readFileSync(new URL('../src/apps/home/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const html = readFileSync(new URL('../src/apps/home/view.html', import.meta.url), 'utf8');
  assert.match(src, /const list = await loadRoutines\(\);/);
  assert.match(src, /nextRunWords\(nextRun\(list, new Date\(\)\), new Date\(\)\)/);
  assert.match(html, /data-go="routines"[\s\S]*id="hmRtVal"/);
});
