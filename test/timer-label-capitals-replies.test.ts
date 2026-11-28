// The cancel and time-left replies keep a named timer's capitals ("the BBQ timer" is not "bbq"). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the cancel reply and the not-found reply use the label as heard', () => {
  assert.ok(voice.includes('const heard = labelAsHeard(tw.label, raw);'));
  assert.ok(voice.includes('const shown = heard.charAt(0).toUpperCase() + heard.slice(1);'));
  assert.ok(voice.includes('`You don’t have ${articleFor(tw.label)} ${heard} timer.`'));
});

test('the time-left replies use the label as heard, for both the found and the not-found timer', () => {
  assert.ok(voice.includes('const heardLeft = labelAsHeard(namedLeft, raw);'));
  assert.ok(voice.includes('`You don’t have ${articleFor(namedLeft)} ${heardLeft} timer.`'));
  assert.ok(voice.includes('left on the ${heardLeft} timer'));
});

test('the matching still uses the lower-case label, so a name is found in any case', () => {
  assert.ok(voice.includes('clock.cancelNamedTimer(tw.label)'));
  assert.ok(voice.includes('clock.namedTimerLeft(namedLeft)'));
});
