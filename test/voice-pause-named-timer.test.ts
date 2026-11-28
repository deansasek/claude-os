// "Pause the pasta timer" and "resume the BBQ timer" by voice (src/core/web/voice-alarm.ts, wired in voice-commands.ts,
// and the clock's named pause and resume in src/apps/clock/web/index.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { timerWord } from '../src/core/web/voice-alarm.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const clock = readFileSync(new URL('../src/apps/clock/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('pausing or resuming a named timer is heard with its label', () => {
  assert.deepEqual(timerWord('pause the pasta timer'), { op: 'pause-named', label: 'pasta' });
  assert.deepEqual(timerWord('hold my bbq timer'), { op: 'pause-named', label: 'bbq' });
  assert.deepEqual(timerWord('resume the pasta timer'), { op: 'resume-named', label: 'pasta' });
  assert.deepEqual(timerWord('unpause the bbq timer'), { op: 'resume-named', label: 'bbq' });
});

test('the bare timer phrases are unchanged, and a time is not a label', () => {
  assert.deepEqual(timerWord('pause the timer'), { op: 'pause' });
  assert.deepEqual(timerWord('resume the timer'), { op: 'resume' });
  assert.equal(timerWord('pause the 10 minute timer'), null);
});

test('the clock pauses or resumes the timer with that label, and the voice reports its state first', () => {
  assert.ok(clock.includes('pauseNamedTimer(label: string): boolean {'));
  assert.ok(clock.includes('resumeNamedTimer(label: string): boolean {'));
  assert.ok(voice.includes("if (tw.op === 'pause-named' || tw.op === 'resume-named') {"));
  assert.ok(voice.includes('if (left.paused) return { say: `The ${heard} timer is already paused.`'));
  assert.ok(voice.includes('if (!left.paused) return { say: `The ${heard} timer is already running.`'));
});
