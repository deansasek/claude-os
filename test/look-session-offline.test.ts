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
  const offline = /catch \{ say\('I can’t reach your PC right now\./;
  assert.match(body, offline);
  assert.ok(body.search(offline) < body.indexOf('v.canReply'), 'the offline catch comes before the canReply check');
});
