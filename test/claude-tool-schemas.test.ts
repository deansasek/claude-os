// The set_timer and alarm schemas state the ranges that their checks require, so the model sees them (src/apps/claude/server/tablet.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const tablet = readFileSync(new URL('../src/apps/claude/server/tablet.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('set_timer states its minute range, and the alarm and reminder days are whole weekdays 0 to 6', () => {
  assert.ok(tablet.includes('{ minutes: z.number().min(MIN_MINUTES).max(MAX_MINUTES), label: z.string().optional() },'));
  assert.equal(tablet.split('days: z.array(z.number().int().min(0).max(6)).max(7).optional()').length - 1, 2);
});
