// Home's Clock tile opens the Timer tab while a timer is running or paused (src/apps/home/web/index.ts). The page is DOM code,
// so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the Clock tile opens the Timer tab when a timer is set', () => {
  const src = readFileSync(new URL('../src/apps/home/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /if \(go === 'clock' && timerNow\(\)\) \{ openApp\('clock'\); dispatchEvent\(new CustomEvent\('hub:clock-tab', \{ detail: 'timer' \}\)\); return; \}/);
});
