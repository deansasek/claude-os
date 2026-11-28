// An alarm set "for tomorrow" does not ring today (src/apps/clock/web/index.ts; the voice wiring in voice-commands.ts).
// The Clock runs in the page, so these checks read its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const clock = readFileSync(new URL('../src/apps/clock/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the Clock marks today’s occurrence done for a one-off set for tomorrow', () => {
  assert.ok(clock.includes('addAlarm(h: number, m: number, days: number[], tomorrow = false)'));
  assert.ok(clock.includes('if (tomorrow && !days.length) { const today = new Date(now()); today.setHours(h, m, 0, 0); a.fired = occKey(a, today); }'));
});

test('the next ring skips an occurrence already marked done', () => {
  assert.ok(clock.includes('&& occKey(a, t) !== a.fired) return t.getTime();'));
});

test('the voice passes "tomorrow" to the Clock', () => {
  assert.ok(voice.includes('clock.addAlarm(h, mins, days, /\\btomorrow\\b/.test(m[2] || \'\'));'));
});
