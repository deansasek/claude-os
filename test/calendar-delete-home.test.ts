// A deleted Calendar event leaves the Home Today tile at once (src/apps/calendar/web/index.ts deleteDetail and
// src/apps/home/web/index.ts). Both pages are DOM code, so this reads their source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const cal = readFileSync(new URL('../src/apps/calendar/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const home = readFileSync(new URL('../src/apps/home/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a successful delete tells the Home screen to reload its calendar', () => {
  const start = cal.indexOf('async function deleteDetail(): Promise<void> {');
  const body = cal.slice(start, cal.indexOf('\n}\n', start));
  const ok = body.indexOf("if (answer?.status === 'ok') {");
  const dispatch = body.indexOf("dispatchEvent(new CustomEvent('hub:calendar'));");
  assert.ok(start > 0, 'deleteDetail() exists');
  assert.ok(ok > 0 && dispatch > ok, 'the event is sent in the success branch');
});

test('Home reloads its calendar when told, without waiting for its refresh gap', () => {
  assert.match(home, /addEventListener\('hub:calendar', \(\) => \{ void loadCalendar\(true\); \}\);/);
});
