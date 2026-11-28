// Backing out of Claude by voice (src/core/web/voice-parse.ts isDismiss, used by src/apps/claude/web/voice.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isDismiss } from '../src/core/web/voice-parse.ts';

const claudeVoice = readFileSync(new URL('../src/apps/claude/web/voice.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the wider dismissals are heard as backing out', () => {
  assert.equal(isDismiss('never mind then'), true);
  assert.equal(isDismiss('oh never mind'), true);
  assert.equal(isDismiss('no thank you'), true);
  assert.equal(isDismiss('no that\'s all'), true);
  assert.equal(isDismiss('forget it then'), true);
  assert.equal(isDismiss('stop listening'), true);
  assert.equal(isDismiss('stop'), true);
});

test('a real question or request is not a dismissal, and "cancel that" is left out on purpose', () => {
  assert.equal(isDismiss('cancel that'), false);
  assert.equal(isDismiss('what is the weather'), false);
  assert.equal(isDismiss('no thanks to the timer please'), false);
});

test('the Claude voice uses the same phrases for both of its backing-out checks', () => {
  assert.ok(claudeVoice.includes('const CANCEL = { test: (s: string): boolean => isDismiss(s) };'));
  assert.ok(claudeVoice.includes('if (CANCEL.test(t) && convo?.turnId'));
  assert.ok(claudeVoice.includes('if (CANCEL.test(t)) { sayLine'));
});
