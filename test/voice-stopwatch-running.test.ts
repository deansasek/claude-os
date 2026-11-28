// "Start the stopwatch" says so when it already runs (src/core/web/voice-commands.ts). The command handler needs the
// browser, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a start when the stopwatch already runs says it is already running', () => {
  assert.match(src, /if \(sws === 'start'\) return clock\.stopwatch\(true\) \? \{ say: '' \} : \{ say: 'The stopwatch is already running\.' \};/);
});
