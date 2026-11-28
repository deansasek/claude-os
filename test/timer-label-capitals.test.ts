// A named timer keeps the capitals it was said with ("a 10 minute BBQ timer" is BBQ, not bbq). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { labelAsHeard, namedTimerReply } from '../src/core/web/voice-parse.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a label found in the speech keeps the capitals heard', () => {
  assert.equal(labelAsHeard('bbq', 'set a 10 minute BBQ timer'), 'BBQ');
  assert.equal(labelAsHeard('pasta', 'set a 10 minute Pasta timer'), 'Pasta');
  assert.equal(labelAsHeard('pasta', 'set a 10 minute pasta timer'), 'pasta');
});

test('a label not found as spoken falls back to the label', () => {
  assert.equal(labelAsHeard('bbq', 'set a timer'), 'bbq');
});

test('the reply capitalises the first letter, and keeps the rest of the label', () => {
  assert.equal(namedTimerReply('BBQ', 600000), 'BBQ timer set for 10 minutes.');
  assert.equal(namedTimerReply('pasta', 600000), 'Pasta timer set for 10 minutes.');
});

test('the named timer is started and replied with the label heard', () => {
  assert.ok(voice.includes('const label = labelAsHeard(dl.label, raw);'));
  assert.ok(voice.includes('if (!clock.startTimer(dl.ms, label))'));
  assert.ok(voice.includes('return { say: namedTimerReply(label, dl.ms), react: \'hop\' };'));
});
