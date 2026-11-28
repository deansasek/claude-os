// "How long is left" says when the timer is paused (src/core/web/voice-commands.ts, provided by src/apps/clock/web/index.ts).
// The Clock needs the browser, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const clock = readFileSync(new URL('../src/apps/clock/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the Clock says whether the timer it reads is paused', () => {
  assert.match(clock, /timerPaused\(\): boolean \{ const t = actionTimer\(\); return !t\.end && t\.left != null; \},/);
});

test('the time-left answer adds that the timer is paused, and the running answer is unchanged', () => {
  assert.match(voice, /const paused = clock\.timerPaused\(\);/);
  assert.match(voice, /left\$\{paused \? ', and the timer is paused' : ''\}\./);
});
