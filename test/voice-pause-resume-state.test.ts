// "Pause the timer" and "resume the timer" say the timer's state when nothing changes (src/core/web/voice-commands.ts).
// The command handler needs the browser, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('pause says the timer is already paused when it is', () => {
  assert.match(src, /return clock\.timerPaused\(\) \? \{ say: 'The timer is already paused\.', react: 'look' \} : \{ say: 'There’s no timer running\.' \};/);
});

test('resume says the timer is already running when one counts down', () => {
  assert.match(src, /return clock\.timerLeft\(\) != null && !clock\.timerPaused\(\) \? \{ say: 'The timer is already running\.', react: 'look' \} : \{ say: 'There’s no paused timer\.' \};/);
});
