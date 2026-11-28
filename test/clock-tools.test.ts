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
  assert.ok(relay.includes('clock.cancelNamedTimer(label) ? `${cap(label)} timer cancelled.`'));
  assert.ok(relay.includes('return runClock(job.op, job.args || {});'));
});

test('clock_status says when the next alarm rings', () => {
  assert.ok(relay.includes('const alarmSay = next ? ` Next alarm: ${hhmm(next.h, next.m)} ${next.when}.` : \'\';'));
  assert.ok(tablet.includes('when the next alarm rings, how many timers and alarms are on, and the stopwatch’s time and whether it runs.'));
});

test('clock_status says the stopwatch’s time and whether it runs, as the voice does', () => {
  assert.ok(relay.includes("import { articleFor, daysText, sayDuration } from '../../../core/web/voice-parse.ts';"));
  assert.ok(relay.includes("const swSay = sw >= 1000 ? ` The stopwatch is ${clock.stopwatchRunning() ? 'running' : 'stopped'} at ${sayDuration(Math.floor(sw / 1000) * 1000)}.` : '';"));
  assert.ok(relay.includes('${alarmSay}${swSay}${nameSay}` };'));
});

test('pause_timer and resume_timer are Claude tools, with the replies the voice gives', () => {
  assert.ok(tablet.includes("tool('pause_timer',"));
  assert.ok(tablet.includes("tool('resume_timer',"));
  assert.ok(relay.includes("const done = pausing ? clock.pauseNamedTimer(label) : clock.resumeNamedTimer(label);"));
  assert.ok(relay.includes("'Timer resumed.'"));
  assert.ok(relay.includes("'There’s no paused timer.'"));
});

test('clock_status and cancel_alarms say a paused timer, and the plural of timers, and one alarm or reminder', () => {
  assert.ok(relay.includes("${clock.timerPaused() ? ', and it is paused' : ''}."));
  assert.ok(relay.includes("${on} timer${on === 1 ? '' : 's'} or alarm${on === 1 ? '' : 's'} on.`"));
  assert.ok(relay.includes("${n} ${n === 1 ? 'alarm or reminder' : 'alarms or reminders'} that Claude set."));
});

test('adjust_timer adds or takes minutes off the timer in front, and says the time left', () => {
  assert.ok(tablet.includes("tool('adjust_timer',"));
  assert.ok(tablet.includes("Math.abs(m) > 60) return { ok: false"));
  assert.ok(relay.includes("if (!m || !clock.nudgeTimer(m)) return { ok: true, data: 'There’s no timer running.' };"));
  assert.ok(relay.includes("return { ok: true, data: `${m > 0 ? 'Added' : 'Took off'} ${amount}.${now}` };"));
});

test('a named timer reply capitalises the name, says already paused or running, and says when there is no such timer', () => {
  assert.ok(relay.includes("import { articleFor, daysText, sayDuration } from '../../../core/web/voice-parse.ts';"));
  assert.ok(relay.includes("const left = clock.namedTimerLeft(label);"));
  assert.ok(relay.includes("if (pausing && left.paused) return { ok: true, data: `The ${label} timer is already paused.` };"));
});

test('adjust_timer takes an optional timer name, and the relay changes that timer', () => {
  assert.ok(tablet.includes("{ minutes: z.number().int().min(-60).max(60), label: z.string().optional() },"));
  assert.ok(tablet.includes("return { ok: true, op, args: { minutes: m, label: cleanText(input.label) } };"));
  assert.ok(relay.includes("if (!m || !clock.nudgeNamedTimer(label, m)) return { ok: true, data: `The ${label} timer can’t be changed.` };"));
});

test('cancel_timer names the timer in front and says how many more are still set', () => {
  assert.ok(relay.includes("const name = clock.actionTimerName(), others = clock.timerCount() - 1;"));
  assert.ok(relay.includes("return { ok: true, data: `${shown}${others > 0 ? ` ${others} more ${others === 1 ? 'is' : 'are'} still set.` : ''}` };"));
});

test('list_alarms is a Claude tool: the alarms that are on, soonest first, with 24-hour times', () => {
  assert.ok(tablet.includes("tool('list_alarms',"));
  assert.ok(relay.includes("if (op === 'list_alarms') {"));
  assert.ok(relay.includes("const all = clock.alarmsOn();"));
  assert.ok(relay.includes("if (!all.length) return { ok: true, data: 'No alarms are on.' };"));
});

test('clock_status names the named timers, so Claude can give one by its label', () => {
  const clockSrc = readFileSync(new URL('../src/apps/clock/web/index.ts', import.meta.url), 'utf8');
  assert.ok(clockSrc.includes("timerNames: (): string[] => timers.filter(t => t.name && (t.end || t.left != null)).map(t => (t.name ?? '').trim()),"));
  assert.ok(relay.includes("const nameSay = names.length ? ` Named timers: ${names.map(n => { const l = clock.namedTimerLeft(n); return l ? `${n} (${l.paused ? 'paused, ' : ''}${sayDuration(Math.floor(l.ms / 1000) * 1000)} left)` : n; }).join(', ')}.` : '';"));
  assert.ok(relay.includes("${alarmSay}${swSay}${nameSay}` };"));
});

test('a named adjust reply says to the timer when adding and from it when taking off', () => {
  const relay = readFileSync(new URL('../src/apps/claude/web/browser-relay.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(relay.includes("${m > 0 ? 'Added' : 'Took off'} ${amount} ${m > 0 ? 'to' : 'from'} the ${label} timer."));
});

test('clock_status says it names the named timers and their time left, and whether one is paused', () => {
  const tablet = readFileSync(new URL('../src/apps/claude/server/tablet.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(tablet.includes('the names of the named timers with their time left'));
  assert.ok(tablet.includes('(and whether it is paused)'));
});
