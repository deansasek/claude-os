// "Cancel the pasta timer" cancels one timer by its label (src/core/web/voice-alarm.ts timerWord, voice-commands.ts,
// src/apps/clock/web/index.ts). The Clock needs the browser, so the two Clock and voice files are read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { timerWord } from '../src/core/web/voice-alarm.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const clock = readFileSync(new URL('../src/apps/clock/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('cancel the pasta timer is read as a cancel by label', () => {
  assert.deepEqual(timerWord('cancel the pasta timer'), { op: 'cancel-named', label: 'pasta' });
  assert.deepEqual(timerWord('turn off my rice timer'), { op: 'cancel-named', label: 'rice' });
});

test('a bare timer, a time or all timers are not a label', () => {
  assert.equal(timerWord('cancel the timer'), null);
  assert.equal(timerWord('cancel my timer'), null);
  assert.equal(timerWord('cancel the 10 minute timer'), null);
  assert.deepEqual(timerWord('cancel all timers'), { op: 'cancel-all' });
});

test('the Clock cancels the listed timer with that name, and the voice says so', () => {
  assert.match(clock, /cancelNamedTimer\(label: string\): boolean \{/);
  assert.match(clock, /const hit = timers\.find\(x => \(x\.name \?\? ''\)\.trim\(\)\.toLowerCase\(\) === want\);/);
  assert.match(voice, /cancelNamedTimer\(label: string\): boolean;/);
  assert.match(voice, /return clock\.cancelNamedTimer\(tw\.label\) \?/);
});
