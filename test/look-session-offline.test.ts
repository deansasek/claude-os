// A Look follow-up that cannot reach the PC says so instead of starting a new session (src/apps/camera/web/look.ts, send).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/camera/web/look.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function send(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('a Look follow-up that cannot reach the PC says so', () => {
  assert.ok(start > 0, 'send() exists');
  const offline = /catch \{ cantReach\(\)/;
  assert.match(body, offline);
  assert.ok(body.search(offline) < body.indexOf('v.canReply'), 'the offline catch comes before the canReply check');
});

test('a Look new session reads projects on its own and says when Scratch space is missing', () => {
  // (a) a failed projects read must not turn into an empty list
  const read = body.indexOf("'/api/claude/projects'");
  assert.ok(read > 0, 'send() reads the projects');
  assert.doesNotMatch(body.slice(read, read + 80), /\.catch\(\(\) => \[\] as Project\[\]\)/);
  // (b) a missing Scratch space is not an offline PC
  const missing = body.match(/if \(!scratch\) \{[^\n]*\}/);
  assert.ok(missing, 'send() has a !scratch branch');
  assert.match(missing[0], /I need a Scratch space project on your PC first\./);
  assert.doesNotMatch(missing[0], /can’t reach your PC/);
});

test('a Look follow-up that hits too many sessions keeps its conversation', () => {
  // the too_many branch comes before the reset, so the Look session id survives
  const tooMany = body.indexOf("v.reason === 'too_many'");
  assert.ok(tooMany > 0, 'send() has a too_many branch');
  assert.match(body.slice(tooMany, tooMany + 160), /Two sessions are already working\. Try again in a moment\./);
  assert.ok(tooMany < body.indexOf('sessionId = null'), 'the too_many branch comes before sessionId = null');
});

test('a Look new session that fails with too_many says two sessions are working', () => {
  const fail = body.indexOf("r.error === 'too_many'");
  assert.ok(fail > 0, 'send() checks the new-session error for too_many');
  assert.match(body.slice(fail, fail + 160), /Two sessions are already working\. Try again in a moment\./);
  assert.ok(fail < body.indexOf("That didn’t start."), 'the too_many check comes before the generic failure line');
});
