// The welcome opens Home before it saves the done flag, and its reads and saves give up on a PC that does not answer
// (src/core/web/welcome.ts). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/core/web/welcome.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const finish = slice('async function finish(');

test('the welcome timeout is defined and the reads and saves pass it', () => {
  assert.match(src, /const WELCOME_TIMEOUT_MS = 10_000;/);
  assert.match(src, /postJson<Profile>\('\/api\/settings\/profile', \{ nickname: v \}, WELCOME_TIMEOUT_MS\)/);
  assert.match(src, /getJson<\{ done\?: boolean \}>\('\/api\/settings\/welcome', WELCOME_TIMEOUT_MS\)/);
});

test('Home opens before the done flag is sent, and the flag is sent with the timeout', () => {
  const home = finish.indexOf("openApp('home')");
  const post = finish.indexOf("postJson('/api/settings/welcome', { done: true }, WELCOME_TIMEOUT_MS)");
  assert.ok(home > 0 && post > 0, 'both calls are in finish()');
  assert.ok(home < post, 'Home opens before the post');
});
