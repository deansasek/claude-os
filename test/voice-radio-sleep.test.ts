// "Turn the radio off in 30 minutes" by voice (src/core/web/voice-radio.ts; the event and the timer are in the voice and the Radio app, read as source).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { radioSleepWord as sleepWord } from '../src/core/web/voice-radio.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const radio = readFileSync(new URL('../src/apps/radio/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the radio sleep lengths the Radio app offers are heard: 15, 30 and 60 minutes', () => {
  assert.equal(sleepWord('turn the radio off in 30 minutes'), 30);
  assert.equal(sleepWord('stop the radio in an hour'), 60);
  assert.equal(sleepWord('radio sleep timer 15 minutes'), 15);
  assert.equal(sleepWord('turn off the radio in 15 minutes'), 15);
});

test('a length the Radio app does not offer, and other radio phrases, are left alone', () => {
  assert.equal(sleepWord('turn the radio off in 20 minutes'), null);
  assert.equal(sleepWord('stop the radio'), null);
  assert.equal(sleepWord('play the radio'), null);
});

test('the voice sets the Radio app’s sleep timer, and the app listens for it', () => {
  assert.ok(voice.includes("new CustomEvent('hub:radio-sleep', { detail: sleepFor })"));
  assert.ok(voice.includes('const sleepFor = radioSleepWord(t);'));
  assert.ok(radio.includes("addEventListener('hub:radio-sleep'"));
  assert.ok(radio.includes('sleepAt = sleepEnd(Date.now(), min);'));
});
