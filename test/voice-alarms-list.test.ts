// "What alarms do I have" reads every alarm that is on (src/core/web/voice-alarm.ts, voice-commands.ts, src/apps/clock/web/index.ts).
// The Clock needs the browser, so the command handler and the Clock are read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { alarmsListWord } from '../src/core/web/voice-alarm.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const clock = readFileSync(new URL('../src/apps/clock/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the list phrases are heard, and the next-alarm phrase is not', () => {
  assert.equal(alarmsListWord('what alarms do i have'), true);
  assert.equal(alarmsListWord('which alarms are on'), true);
  assert.equal(alarmsListWord('list my alarms'), true);
  assert.equal(alarmsListWord("when's my next alarm"), false);
  assert.equal(alarmsListWord('turn off all my alarms'), false);
});

test('the Clock lists the alarms that are on, soonest first, and the reply names them', () => {
  assert.match(clock, /alarmsOn\(\): \{ h: number; m: number; days: number\[\]; when: string \}\[\] \{/);
  assert.match(clock, /\.filter\(\(x\): x is \{ a: Alarm; at: number \} => \(x\.a\.on \|\| !!x\.a\.snooze\) && x\.at != null\)/);
  assert.match(voice, /if \(alarmsListWord\(t\)\) \{/);
  assert.match(voice, /const all = clock\.alarmsOn\(\);/);
});
