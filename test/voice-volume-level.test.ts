// "What's the volume" by voice (src/core/web/voice-commands.ts). The command reads the device, so it is checked as source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the volume question is answered from the media level, and changes nothing', () => {
  assert.ok(voice.includes('function volumeLevel(): CommandResult {'));
  assert.ok(voice.includes('const p = Math.round(cur * 100);'));
  assert.ok(voice.includes('`The volume is at ${p} percent.`'));
  assert.ok(voice.includes("p === 0 ? 'The tablet is muted.'"));
  // the read is in volumeLevel, which never calls setVolume
  const body = voice.slice(voice.indexOf('function volumeLevel()'), voice.indexOf('function volume(to'));
  assert.ok(!body.includes('setVolume'));
});

test('the phrases "what\'s the volume", "how loud is it" and "what volume is it" reach volumeLevel before the up and down phrases', () => {
  assert.ok(voice.includes("what(?:'s| is) the volume(?: right now| now)?|how loud is it(?: right now| now)?|what volume is it(?: on)?"));
  assert.ok(voice.indexOf('return volumeLevel();') < voice.indexOf("if (/^(?:turn |turn it |turn the volume |volume |sound )?up$"));
});

test('the header lists the read-only volume question', () => {
  assert.ok(voice.includes('"what\'s the volume" (read-only)'));
});
