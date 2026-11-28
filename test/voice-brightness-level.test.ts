// "What's the brightness" by voice (src/core/web/voice-commands.ts). The command reads the saved level, so it is checked as source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the brightness question reads the saved level and changes nothing', () => {
  assert.ok(voice.includes('function brightnessLevel(): CommandResult {'));
  assert.ok(voice.includes('`The brightness is at ${pct(prefs.brightness)}.`'));
  const body = voice.slice(voice.indexOf('function brightnessLevel()'), voice.indexOf('function volume(to'));
  assert.ok(!body.includes('prefs.brightness ='));
  assert.ok(!body.includes('brightness('));
});

test('with auto-brightness on, the answer uses the same words as the brightness change', () => {
  assert.ok(voice.includes("'Auto-brightness is on, so the screen sets its own brightness.', react: 'look'"));
});

test('the phrases reach brightnessLevel before the dim and brighten phrases', () => {
  assert.ok(voice.includes("what(?:'s| is) the brightness(?: right now| now)?|how bright is the screen(?: right now| now)?"));
  assert.ok(voice.indexOf('return brightnessLevel();') < voice.indexOf("if (/^(?:dim|jim|darken)(?: the)? screen$"));
});

test('the header lists the read-only brightness question', () => {
  assert.ok(voice.includes('"what\'s the brightness" (read-only)'));
});
