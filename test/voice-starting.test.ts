// A queued listen while the tablet loads its speech model (src/core/web/voice-ui.ts, src/apps/claude/web/voice.ts).
// Source-text checks: the page must show "starting", not "try again", and must not queue a second listen.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ui = readFileSync(new URL('../src/core/web/voice-ui.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/apps/claude/web/voice.ts', import.meta.url), 'utf8');

test('the page drops the fixed 2.5 s "still starting" guess', () => {
  assert.ok(!app.includes('Voice is still starting'));
  assert.ok(!app.includes('2500'));
});

test('while the tablet loads, the pill says starting and does not say try again', () => {
  assert.match(ui, /e\.mode === 'loading'/);
  const view = ui.match(/case 'starting': return \{[^}]*\}/);
  assert.ok(view, 'starting view is defined');
  assert.match(view[0], /Starting voice/);
  assert.doesNotMatch(view[0], /try again/i);
});

test('"try again" shows only when the start has really failed', () => {
  // the failure paths: a queued listen past START_LIMIT_MS that never started, and a tablet error event
  assert.match(ui, /if \(live\?\.kind === 'starting'\) setLive\(\{ kind: 'notice', title: 'Voice isn’t working right now', sub: 'Try again in a moment' \}/);
  assert.match(ui, /case 'error':\s*queued = false;/);
});

test('a second tap does not queue another listen', () => {
  assert.match(app, /const talk = \(\) => \{\s*if \(voiceUi\.isStarting\(\)\) return;/);
  assert.match(app, /if \(voiceUi\.isStarting\(\)\) return;\s*\/\/ a listen is already queued/);
  assert.match(ui, /if \(voiceUi\.isStarting\(\)\) return;   \/\/ a listen is already queued/);
  assert.match(ui, /isStarting\(\): boolean \{ return queued \|\| live\?\.kind === 'starting'; \}/);
});

test('a listen that the tablet already started is not marked as queued', () => {
  assert.match(ui, /if \(m === 'listening'\) return;/);
});
