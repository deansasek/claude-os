// Claude's timer tools follow the Clock's list of timers (src/apps/claude/server/tablet.ts, web/browser-relay.ts).
// The tools run in the SDK and on the tablet, so their wiring is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const tablet = readFileSync(new URL('../src/apps/claude/server/tablet.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const relay = readFileSync(new URL('../src/apps/claude/web/browser-relay.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('set_timer says the Clock keeps a list of timers, not that one timer blocks another', () => {
  assert.ok(tablet.includes('The Clock keeps a list of timers, each with its own label: this fails only when the list is full.'));
  assert.equal(tablet.includes('The Clock has one timer'), false);
});

test('cancel_timer takes an optional label, and the relay cancels that timer by name', () => {
  assert.ok(tablet.includes("tool('cancel_timer',"));
  assert.ok(tablet.includes("{ label: z.string().optional() },\n      async ({ label }) => run('cancel_timer', label ? { label } : {})),"));
  assert.ok(tablet.includes("if (op === 'cancel_timer') return { ok: true, op, args: { label: cleanText(input.label) } };"));
  assert.ok(relay.includes('clock.cancelNamedTimer(label) ? `${label} timer cancelled.`'));
  assert.ok(relay.includes('return runClock(job.op, job.args || {});'));
});
