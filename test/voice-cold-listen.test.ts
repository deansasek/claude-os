// The first listen after a cold start picks its recogniser like every later listen (android/src/hub/kiosk/VoiceService.java).
// Source-text check: run() must call beginRequest, not startListen (which always uses Vosk).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../android/src/hub/kiosk/VoiceService.java', import.meta.url), 'utf8');
const run = src.slice(src.indexOf('private void run(int listenFirst)'), src.indexOf('private void closeAll()'));

test('the cold first listen goes through beginRequest, the same as later listens', () => {
  assert.match(run, /if \(listenFirst > 0\) \{[^}]*beginRequest\(null, listenFirst, false\);/);
});

test('the cold first listen does not start Vosk directly', () => {
  assert.doesNotMatch(run, /startListen\(listenFirst/);
});

test('the cold first listen does not allow a "didn\'t catch that" retry, like listen() and dictate()', () => {
  assert.match(run, /retriesLeft = 0;\s*try \{ beginRequest\(null, listenFirst, false\); \}/);
});
