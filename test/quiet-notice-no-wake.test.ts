// A notice during quiet hours does not wake the ambient screen (src/core/web/system.ts notify). system.ts needs the browser, so
// this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/core/web/system.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('export function notify(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('a notice in quiet hours with the ambient screen on returns before it wakes the screen or shows a banner', () => {
  assert.ok(start > 0, 'notify() exists');
  const guard = body.indexOf('if (quietNow() && ambientOn) return;');
  const wakeAt = body.indexOf('wake();');
  const banner = body.indexOf("const b = $s('banner');");
  assert.ok(guard > 0, 'quiet hours guard exists');
  assert.ok(guard < wakeAt && wakeAt < banner, 'the guard runs before wake() and before the banner is built');
});

test('a notice outside quiet hours still wakes the screen as before', () => {
  assert.match(body, /\n  wake\(\);\n/);
});
