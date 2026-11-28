// "Stop the stopwatch" says so when it is not running (src/core/web/voice-commands.ts). The command handler needs the
// browser, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a stop when the stopwatch is not running says so, with its time when it has one', () => {
  assert.match(src, /if \(clock\.stopwatchRunning\(\)\) \{ clock\.stopwatch\(false\); return \{ say: 'Stopped\.' \}; \}/);
  assert.match(src, /return \{ say: left < 1000 \? 'The stopwatch isn’t running\.' : `The stopwatch is already stopped at \$\{sayDuration\(Math\.floor\(left \/ 1000\) \* 1000\)\}\.` \};/);
});
