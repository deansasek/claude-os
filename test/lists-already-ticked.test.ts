// Ticking off an item that is already ticked says so, not that it can't be found (src/core/web/voice-commands.ts).
// The reply is in the command handler, so it is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('an item that is already ticked off is said to be ticked off, found among the ticked items too', () => {
  assert.ok(voice.includes('const done = ambiguous ? undefined : pickItem(l.items, c.text, false).hit;'));
  assert.ok(voice.includes('if (done?.done) return { say: `${done.text.charAt(0).toUpperCase() + done.text.slice(1)} is already ticked off on ${name}.`'));
});

test('an item not on the list at all still says it cannot be found', () => {
  assert.ok(voice.includes('`I can’t find ${c.text} on ${name}.`'));
});
