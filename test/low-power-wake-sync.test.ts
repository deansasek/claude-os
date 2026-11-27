// Turning on low power or quiet hours pauses "Hey Claude" at once, not in up to 20 seconds (src/core/web/system.ts setters).
// The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/core/web/system.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('the quiet-hours setter syncs the wake word before it repaints', () => {
  const line = src.split('\n').find(l => l.includes('set quiet(q: QuietHours)'));
  assert.ok(line, 'the quiet setter exists');
  assert.ok(line.indexOf('syncWake();') > 0 && line.indexOf('syncWake();') < line.indexOf('sysChanged();'));
});

test('the low-power setter syncs the wake word before it repaints', () => {
  const line = src.split('\n').find(l => l.includes('set lowPower(v: boolean)'));
  assert.ok(line, 'the low-power setter exists');
  assert.ok(line.indexOf('syncWake();') > 0 && line.indexOf('syncWake();') < line.indexOf('sysChanged();'));
});
