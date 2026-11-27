// Look's send gives up on a session or project read the PC never answers, and says nothing or keeps no session once Look is stopped
// (src/apps/camera/web/look.ts send). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/camera/web/look.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function send(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the session read has a timeout', () => {
  assert.ok(start > 0, 'send() exists');
  const line = body.split('\n').find(l => l.includes('encodeURIComponent(sessionId)}'));
  assert.ok(line, 'the session read is in send()');
  assert.match(line, /READ_TIMEOUT_MS\)/);
});

test('the projects read has a timeout', () => {
  const line = body.split('\n').find(l => l.includes("'/api/claude/projects'"));
  assert.ok(line, 'the projects read is in send()');
  assert.match(line, /READ_TIMEOUT_MS\)/);
});

test('a session is kept only while Look is still on', () => {
  assert.match(body, /if \(!on\) return null;/);
  const set = body.indexOf('sessionId = r.sessionId;');
  assert.ok(set > 0, 'the new session is recorded');
  assert.ok(body.lastIndexOf('if (!on) return null;', set) > body.indexOf('apiCall<NewSessionResult>'), 'the check comes after the new-session call and before the session is kept');
});

test('a late failure is not spoken after Look has stopped', () => {
  assert.match(src, /const cantReach = \(\): void => \{ if \(on\) say\(/);
  assert.doesNotMatch(body, /catch \{ say\(/);
});
