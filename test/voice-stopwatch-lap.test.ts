// Marking a stopwatch lap by voice (src/core/web/voice-stopwatch.ts; the reply and the Clock method are checked as source).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { stopwatchWord } from '../src/core/web/voice-stopwatch.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const clock = readFileSync(new URL('../src/apps/clock/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the lap phrases are heard, and the stopwatch start, stop and reset phrases are not changed', () => {
  assert.equal(stopwatchWord('mark a lap'), 'lap');
  assert.equal(stopwatchWord('take a lap'), 'lap');
  assert.equal(stopwatchWord('lap'), 'lap');
  assert.equal(stopwatchWord('split'), 'lap');
  assert.equal(stopwatchWord('stopwatch lap'), 'lap');
  assert.equal(stopwatchWord('start the stopwatch'), 'start');
  assert.equal(stopwatchWord('reset the stopwatch'), 'reset');
  assert.equal(stopwatchWord('mark the tea'), null);
});

test('a lap says its number, and a stopped stopwatch says it is not running', () => {
  assert.ok(voice.includes('const n = clock.stopwatchLap();'));
  assert.ok(voice.includes("n === null ? { say: 'The stopwatch isn’t running.' } : { say: `Lap ${n}.`, react: 'hop' }"));
});

test('the Clock marks the lap with its own Lap action, and does nothing when stopped', () => {
  assert.ok(clock.includes('stopwatchLap(): number | null { if (!sw.running) return null; swLap(); return sw.laps.length; }'));
  assert.ok(voice.includes('stopwatchLap(): number | null;'));
});
