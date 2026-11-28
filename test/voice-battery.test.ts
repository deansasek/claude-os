// "What's the battery" by voice (src/core/web/voice-battery.ts). The read is in voice-commands.ts (read as source).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { batterySay, batteryWord } from '../src/core/web/voice-battery.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the battery questions are matched, with or without "now" or "left"', () => {
  assert.equal(batteryWord("what's the battery"), true);
  assert.equal(batteryWord('what is the battery level now'), true);
  assert.equal(batteryWord('how much battery is left'), true);
  assert.equal(batteryWord('is the tablet charging'), true);
  assert.equal(batteryWord('battery level'), true);
});

test('other questions are not battery questions', () => {
  assert.equal(batteryWord('what is the volume'), false);
  assert.equal(batteryWord('is the battery in my car ok'), false);
});

test('the reply gives the charge, and says charging or full when it is', () => {
  assert.equal(batterySay({ percent: 64, charging: true, full: false }), 'The battery is at 64 percent and charging.');
  assert.equal(batterySay({ percent: 100, charging: true, full: true }), 'The battery is at 100 percent and full.');
  assert.equal(batterySay({ percent: 41.6, charging: false, full: false }), 'The battery is at 42 percent.');
  assert.equal(batterySay({ percent: Number.NaN, charging: false, full: false }), 'I can’t read the battery right now.');
});

test('the command reads the device battery on the tablet only, and says so when the read fails', () => {
  assert.ok(voice.includes('if (batteryWord(t)) return batteryCommand();'));
  assert.ok(voice.includes("if (!onTablet) return { say: 'I can only check the battery on the tablet.' };"));
  assert.ok(voice.includes('try { b = device.battery(); } catch { return { say: \'I can’t read the battery right now.\' }; }'));
});
