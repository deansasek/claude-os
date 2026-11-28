// The calendar_range tool has plain words on the approval card, as calendar_today has (src/apps/claude/web/tools.ts).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const cards = readFileSync(new URL('../src/apps/claude/web/tools.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('calendar_range has the same plain words as calendar_today on the approval card', () => {
  assert.ok(cards.includes("'mcp__claudeos_calendar__calendar_range': { now: 'Look at your calendar', past: 'Looked at your calendar', doing: 'Looking at your calendar' },"));
});
