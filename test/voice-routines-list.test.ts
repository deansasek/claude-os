// "What routines do I have" reads the routine names and runs nothing (src/core/web/voice-commands.ts routineCommand). The
// command handler needs the browser, so it is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the routine list phrases are read from the Routines app, before the empty-list return', () => {
  assert.ok(voice.includes("what routines (?:do i have|have i got|are there)|which routines (?:do i have|have i got)|list my routines|what are my routines"));
  const at = voice.indexOf('const names = list.map(r => r.name);');
  const guard = voice.indexOf('if (!list.length) return null;', at);
  assert.ok(at > 0 && guard > at, 'the list answer comes before the empty-list return');
});

test('the reply says none yet, names up to four, and counts the rest', () => {
  assert.ok(voice.includes("You don’t have any routines yet."));
  assert.ok(voice.includes('and ${more} more'));
});
