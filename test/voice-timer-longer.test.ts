// "How much longer on the timer" and "how many minutes are left" read the timer's time (src/core/web/voice-commands.ts). The
// command handler needs the browser, so it is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { countdownWord } from '../src/core/web/voice-countdown.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the everyday time-left phrases are in the timer read', () => {
  assert.ok(voice.includes('how much longer(?: is it)?(?: on (?:the|my) timer)?'));
  assert.ok(voice.includes('how many (?:minutes|seconds)(?: are)? left(?: on (?:the|my) timer)?'));
});

test('the Christmas countdown still takes its own days-left phrase, and a timer days-left is not a countdown', () => {
  assert.equal(countdownWord('how many days left until christmas'), true);
  assert.equal(countdownWord('how many days left on the timer'), false);
});
