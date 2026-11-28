// The set_alarm and set_reminder descriptions say that days repeat the alarm, so Claude sets a repeat (src/apps/claude/server/tablet.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const tablet = readFileSync(new URL('../src/apps/claude/server/tablet.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('set_alarm says days repeats the alarm, and set_reminder can repeat too', () => {
  assert.ok(tablet.includes("'Set an alarm in the Clock on the user’s ClaudeOS tablet. time: HH:MM on the 24-hour clock, in the tablet’s local time. '"));
  assert.ok(tablet.includes("give days to repeat it, e.g. [1,2,3,4,5] every weekday. "));
  assert.doesNotMatch(tablet, /Set a one-off alarm/);
  assert.ok(tablet.includes("one time only, or repeat it with days"));
});
