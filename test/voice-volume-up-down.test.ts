// "Turn up the volume", "turn down the volume" (src/core/web/voice-commands.ts). The matchers sit inside runCommand, so they are read as source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('"turn up the volume" and "turn up the sound" are heard as volume up', () => {
  assert.ok(voice.includes("|^turn up(?: the)? (?:volume|sound)$|^louder$|"));
});

test('"turn down the volume" and "turn down the sound" are heard as volume down', () => {
  assert.ok(voice.includes("|^turn down(?: the)? (?:volume|sound)$|^quieter$|"));
});

test('the existing up and down phrasings are still there', () => {
  assert.ok(voice.includes("^(?:turn |turn it |turn the volume |volume |sound )?up$"));
  assert.ok(voice.includes("^(?:turn |turn it |turn the volume |volume |sound )?down$"));
});
