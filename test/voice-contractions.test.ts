// "How long's left" and "what time's my alarm" are heard with the contraction (src/core/web/voice-commands.ts). The
// command handler needs the browser, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('how long’s left is heard with or without the space', () => {
  assert.match(src, /how \(\?:much time\|long\)\(\?:'s\| is\)\? \(\?:left\|remaining\|to go\)/);
});

test('what time’s my alarm is heard as the contraction', () => {
  assert.match(src, /what time\(\?:'s\| is\) my alarm/);
});
