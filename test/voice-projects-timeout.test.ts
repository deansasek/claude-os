// A spoken request for a new session gives up on the folder read when the PC does not answer, so the voice always replies
// (src/apps/claude/web/voice.ts handle). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/claude/web/voice.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function handle(');
const body = src.slice(start, src.indexOf('\nasync function send(', start));

test('the timeout is set and at most 30 seconds', () => {
  const m = src.match(/const READ_TIMEOUT_MS = ([\d.e]+);/);
  assert.ok(m && Number(m[1]) > 0 && Number(m[1]) <= 30e3, 'READ_TIMEOUT_MS is set');
});

test('the folder read passes the timeout, and its catch still says the PC cannot be reached', () => {
  assert.match(body, /getJson<Project\[\]>\('\/api\/claude\/projects', READ_TIMEOUT_MS\)/);
  assert.match(body, /catch \{ voiceUi\.notice\('Can’t reach your PC'[^}]*say\('I can’t reach your PC right now\.'\); return; \}/);
});
