// A touch after a long time away starts a new break, so the time asleep is not counted as use (src/core/web/system.ts touched).
// system.ts needs the browser, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/core/web/system.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('function touched(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('a touch after a long time away resets the break count before it records the touch', () => {
  assert.ok(start > 0, 'touched() exists');
  const reset = body.indexOf('breakSince = now; breakNudged = false;');
  const record = body.indexOf('lastTouch = now;');
  assert.ok(reset > 0 && record > reset, 'the reset comes before the touch is recorded');
});

test('the pointer and wake paths both go through touched()', () => {
  assert.match(src, /document\.addEventListener\('pointerdown', \(\) => touched\(\), true\);/);
  assert.match(src, /function wake\([^)]*\)[^{]*\{[\s\S]*?touched\(\);/);
});
