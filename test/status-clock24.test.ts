// The status bar repaints its clock when the 12/24-hour setting changes (src/core/web/status.ts). Source-text check: the module
// loads the page's DOM, so this reads the file. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/core/web/status.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a change to os.clock24 forgets the minute, so the next tick repaints the time', () => {
  assert.match(src, /if \(k === 'os\.clock24'\) st\.minute = -1;/);
});

test('the clock setting also runs the status bar tick', () => {
  assert.match(src, /if \(k === 'os\.clock24' \|\| k === CLOCK_TIMERS_KEY \|\| k === CLOCK_TIMER_KEY \|\| k === K_RING\) tick\(\);/);
});
