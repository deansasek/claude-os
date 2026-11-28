// "Say that again" by voice (src/core/web/voice-repeat.ts). The wiring is in src/apps/claude/web/voice.ts (read as source).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { repeatWord } from '../src/core/web/voice-repeat.ts';

const voice = readFileSync(new URL('../src/apps/claude/web/voice.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the repeat phrases are heard, with and without "please" and "again"', () => {
  assert.equal(repeatWord('say that again'), true);
  assert.equal(repeatWord('say it again'), true);
  assert.equal(repeatWord('repeat that'), true);
  assert.equal(repeatWord('repeat that please'), true);
  assert.equal(repeatWord('what did you say'), true);
  assert.equal(repeatWord('can you say that again'), true);
  assert.equal(repeatWord('come again'), true);
});

test('other phrases are not a repeat request', () => {
  assert.equal(repeatWord('say hello'), false);
  assert.equal(repeatWord('repeat the alarm'), false);
  assert.equal(repeatWord('what did you do'), false);
});

test('the last spoken text is kept, and a repeat says it again or says there is nothing yet', () => {
  assert.ok(voice.includes("let lastSaid = '';"));
  assert.ok(voice.includes('lastSaid = text;'));
  assert.ok(voice.includes("if (repeatWord(t)) { say(lastSaid || 'I haven’t said anything yet.'"));
});
