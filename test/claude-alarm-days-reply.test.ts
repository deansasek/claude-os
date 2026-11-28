// The set_alarm and set_reminder replies say the repeat days, as the voice and list_alarms do (src/apps/claude/web/browser-relay.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const relay = readFileSync(new URL('../src/apps/claude/web/browser-relay.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('an alarm or reminder that repeats says its days, and one that does not says when it rings', () => {
  assert.ok(relay.includes("`Alarm set for ${hhmm(h, m)}${days.length ? daysText(days) : ` ${set.when}`}${label ? ` (${label})` : ''}.`"));
  assert.ok(relay.includes("`Reminder set for ${hhmm(h, m)}${days.length ? daysText(days) : ` ${set.when}`}: “${label}”."));
});
