// "What wifi am I on" by voice (src/core/web/voice-wifi.ts). The read is in voice-commands.ts (read as source).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { wifiSay, wifiWord } from '../src/core/web/voice-wifi.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the Wi-Fi questions are matched, with or without "now" or "network"', () => {
  assert.equal(wifiWord('what wifi am i on'), true);
  assert.equal(wifiWord('what wi-fi am i on'), true);
  assert.equal(wifiWord("what's the wifi network"), true);
  assert.equal(wifiWord('what is the wi-fi now'), true);
  assert.equal(wifiWord('am i connected to the wifi'), true);
  assert.equal(wifiWord('is the wifi on'), true);
});

test('other questions are not Wi-Fi questions', () => {
  assert.equal(wifiWord('what is the battery'), false);
  assert.equal(wifiWord('what wifi password'), false);
  assert.equal(wifiWord('turn on the wifi'), false);
});

test('the answer names the network, or says it is off or not connected', () => {
  assert.equal(wifiSay({ enabled: true, ssid: 'Home Network' }), 'You’re on Home Network.');
  assert.equal(wifiSay({ enabled: true, ssid: '  ' }), 'Wi-Fi is on, but not connected.');
  assert.equal(wifiSay({ enabled: true }), 'Wi-Fi is on, but not connected.');
  assert.equal(wifiSay({ enabled: false, ssid: 'Home Network' }), 'Wi-Fi is off.');
});

test('the voice reads the device’s Wi-Fi state, changes nothing, and says so off the tablet', () => {
  assert.ok(voice.includes('function wifiCommand(): CommandResult {'));
  assert.ok(voice.includes("if (!onTablet) return { say: 'I can only check the Wi-Fi on the tablet.' };"));
  assert.ok(voice.includes('w = device.wifi();'));
  assert.ok(voice.includes('if (wifiWord(t)) return wifiCommand();'));
  const body = voice.slice(voice.indexOf('function wifiCommand()'), voice.indexOf("/** \"What's the volume\""));
  assert.ok(!body.includes('wifiScan'));
  assert.ok(!body.includes('setWifi'));
});
