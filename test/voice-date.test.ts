// The date phrases (src/core/web/voice-commands.ts). The command handler needs the browser, so it is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('what date is it, what is the day today, and the date now are heard with the existing forms', () => {
  assert.ok(voice.includes('what date is it(?: today)?'));
  assert.ok(voice.includes('what(?:\'s| is) the day(?: today)?'));
  assert.ok(voice.includes('the date(?: now| right now)?'));
  assert.ok(voice.includes('what day is (?:it|today)(?: today)?'));
});
