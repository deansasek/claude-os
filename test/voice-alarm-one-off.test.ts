// "Turn off my alarm" with only one alarm on (src/core/web/voice-commands.ts). The reply is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('with only one alarm on, "turn off my alarm" switches that one off', () => {
  assert.ok(voice.includes('if (on.length === 1) {'));
  assert.ok(voice.includes('const n = clock.switchOffAlarm(only.h, only.m);'));
  assert.ok(voice.includes('`Okay, your ${clockText(only.h, only.m)} alarm is off.`'));
});

test('with two or more alarms on, the "all my alarms" rule still applies and nothing is switched off', () => {
  assert.ok(voice.includes("return { say: 'Nothing is ringing. To switch them all off, say turn off all my alarms.' };"));
});
