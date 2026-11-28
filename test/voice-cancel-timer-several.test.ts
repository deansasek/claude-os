// "Cancel the timer" names the timer it cancelled and says how many others stay set (src/core/web/voice-commands.ts, provided
// by src/apps/clock/web/index.ts). The Clock needs the browser, so both are read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const clock = readFileSync(new URL('../src/apps/clock/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the Clock says which timer is picked and how many are listed', () => {
  assert.match(clock, /actionTimerName: \(\): string \| null => actionTimer\(\)\.name \|\| null,/);
  assert.match(clock, /timerCount: \(\): number => timers\.length,/);
});

test('the reply names the cancelled timer and counts the others that stay set', () => {
  assert.match(voice, /const name = clock\.actionTimerName\(\), others = clock\.timerCount\(\) - 1;/);
  assert.match(voice, /const left = others > 0 \? ` \$\{others\} more \$\{others === 1 \? 'is' : 'are'\} still set\.` : '';/);
  assert.match(voice, /const shown = name \? `\$\{name\.charAt\(0\)\.toUpperCase\(\)\}\$\{name\.slice\(1\)\} timer cancelled\.` : 'Timer cancelled\.';/);
});
