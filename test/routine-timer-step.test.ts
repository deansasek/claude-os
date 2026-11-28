// A routine's timer step is said as the voice says a timer: 90 minutes is "1 hour and 30 minutes" (src/apps/routines/web/run.ts,
// on sayDuration in voice-parse.ts). run.ts needs the DOM, so the line is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { sayDuration } from '../src/core/web/voice-parse.ts';

const run = readFileSync(new URL('../src/apps/routines/web/run.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a 90-minute step is said as an hour and a half, as the voice says it', () => {
  assert.equal(sayDuration(90 * 60e3), '1 hour and 30 minutes');
});

test('the routine timer line uses sayDuration, not the raw minutes', () => {
  assert.ok(run.includes('return `Timer set for ${sayDuration(s.minutes * 60e3)}.`;'));
  assert.equal(run.includes('Timer set for ${s.minutes} minute'), false);
  assert.ok(run.includes("import { sayDuration } from '../../../core/web/voice-parse.ts';"));
});
