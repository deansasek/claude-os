// A timer that cannot be added (the Clock's list is full) is said so by voice, routines and the Claude relay. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const read = (rel: string): string => fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf8').replace(/\r\n/g, '\n');

test('the Clock reports a full list: startTimer returns false when the list is at its limit', () => {
  const src = read('src/apps/clock/web/index.ts');
  assert.match(src, /startTimer\(ms: number, label\?: string\): boolean \{\s*if \(timers\.length >= MAX_TIMERS\) return false;/);
});

test('voice, routines and the Claude relay each answer the full list instead of a timer set', () => {
  assert.match(read('src/core/web/voice-commands.ts'), /if \(!clock\.startTimer\(ms\)\) return \{ say: 'The timer list is full\. Stop a timer first\.' \};/);
  assert.match(read('src/core/web/voice-commands.ts'), /if \(!clock\.startTimer\(dl\.ms, dl\.label\)\) return/);
  assert.match(read('src/apps/routines/web/run.ts'), /if \(!clock\.startTimer\(s\.minutes \* 60e3\)\) return 'The Clock’s timer list is full, so no timer\.';/);
  assert.match(read('src/apps/claude/web/browser-relay.ts'), /if \(!clock\.startTimer\(ms, label\)\) return \{ ok: false/);
});
