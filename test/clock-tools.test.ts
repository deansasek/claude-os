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
  assert.ok(tablet.includes("if (op === 'cancel_timer' || op === 'pause_timer' || op === 'resume_timer') return { ok: true, op, args: { label: cleanText(input.label) } };"));
  assert.ok(relay.includes('clock.cancelNamedTimer(label) ? `${label} timer cancelled.`'));
  assert.ok(relay.includes('return runClock(job.op, job.args || {});'));
});

test('clock_status says when the next alarm rings', () => {
  assert.ok(relay.includes('const alarmSay = next ? ` Next alarm: ${hhmm(next.h, next.m)} ${next.when}.` : \'\';'));
  assert.ok(tablet.includes('when the next alarm rings, how many timers and alarms are on, and the stopwatch’s time and whether it runs.'));
});

test('clock_status says the stopwatch’s time and whether it runs, as the voice does', () => {
  assert.ok(relay.includes("import { sayDuration } from '../../../core/web/voice-parse.ts';"));
  assert.ok(relay.includes("const swSay = sw >= 1000 ? ` The stopwatch is ${clock.stopwatchRunning() ? 'running' : 'stopped'} at ${sayDuration(Math.floor(sw / 1000) * 1000)}.` : '';"));
  assert.ok(relay.includes('${alarmSay}${swSay}` };'));
});

test('pause_timer and resume_timer are Claude tools, with the replies the voice gives', () => {
  assert.ok(tablet.includes("tool('pause_timer',"));
  assert.ok(tablet.includes("tool('resume_timer',"));
  assert.ok(relay.includes("const done = pausing ? clock.pauseNamedTimer(label) : clock.resumeNamedTimer(label);"));
  assert.ok(relay.includes("'Timer resumed.'"));
  assert.ok(relay.includes("'There’s no paused timer.'"));
});

test('adjust_timer adds or takes minutes off the timer in front, and says the time left', () => {
  assert.ok(tablet.includes("tool('adjust_timer',"));
  assert.ok(tablet.includes("Math.abs(m) > 60) return { ok: false"));
  assert.ok(relay.includes("if (!m || !clock.nudgeTimer(m)) return { ok: true, data: 'There’s no timer running.' };"));
  assert.ok(relay.includes("return { ok: true, data: `${m > 0 ? 'Added' : 'Took off'} ${amount}.${now}` };"));
});
