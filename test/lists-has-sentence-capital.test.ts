// "Is milk on the list" when the item is ticked off: the reply starts with a capital, as the sentence does.
// The replies are read as source (src/core/web/voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a ticked-off item that starts the sentence keeps a capital, on a named list and on any list', () => {
  assert.ok(voice.includes('`${subject} is on ${name}, but it’s ticked off.`'));
  assert.equal(voice.includes('`${shown} is on ${name}, but it’s ticked off.`'), false);
  assert.equal(voice.includes('`${word} is on ${name}, but it’s ticked off.`'), false);
  assert.equal(voice.split('const subject = hit.text.charAt(0).toUpperCase() + hit.text.slice(1);').length - 1, 2);
});

test('the "Yes" reply keeps the lower-case item, since it follows "Yes,"', () => {
  assert.ok(voice.includes('`Yes, ${shown} is on ${name}.`'));
  assert.ok(voice.includes('`Yes, ${word} is on ${name}.`'));
});
