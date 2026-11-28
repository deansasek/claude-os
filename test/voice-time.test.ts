// Spoken clock times share one format: no leading zero, as the alarm replies say them (src/core/web/voice-commands.ts).
// The format is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('one helper formats the spoken time, and drops the leading zero', () => {
  assert.ok(voice.includes("const timeText = (d: Date): string => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/^0/, '');"));
  assert.ok(voice.includes('const clockText = (h: number, m: number) => timeText(new Date(2000, 0, 1, h, m));'));
});

test('every spoken clock time goes through that helper, so none is formatted another way', () => {
  const direct = voice.match(/toLocaleTimeString\(\[\], \{ hour: 'numeric', minute: '2-digit' \}\)/g) ?? [];
  assert.equal(direct.length, 1, 'only the helper itself calls toLocaleTimeString with these options');
  assert.ok((voice.match(/timeText\(/g) ?? []).length >= 7);
});
