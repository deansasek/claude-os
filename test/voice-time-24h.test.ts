// Spoken clock times follow the 24-hour setting (src/core/web/voice-commands.ts timeText, on hourMinuteFormat in
// time-format.ts). The voice reads the device, so the wiring is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { hourMinuteFormat } from '../src/core/web/time-format.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const nine = new Date(2000, 0, 1, 9, 5);

test('a 24-hour spoken time has no leading zero: 9:05, not 09:05', () => {
  assert.equal(hourMinuteFormat('1').format(nine).replace(/^0/, ''), '9:05');
  assert.equal(hourMinuteFormat('0').format(nine).replace(/^0/, ''), '9:05 AM');
});

test('the spoken time reads the setting, and no longer a fixed locale format', () => {
  assert.ok(voice.includes("const timeText = (d: Date): string => hourMinuteFormat(store.get('os.clock24')).format(d).replace(/^0/, '');"));
  assert.ok(voice.includes("import { hourMinuteFormat } from './time-format.ts';"));
  assert.equal(voice.includes("const timeText = (d: Date): string => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })"), false);
});
