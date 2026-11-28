// Every Home Assistant post gives up on a PC that does not answer, so the settings, layout and switch rows never stay busy
// (src/apps/home-assistant/web/index.ts). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/home-assistant/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('the post timeout is defined', () => {
  assert.match(src, /const POST_TIMEOUT_MS = 15_000;/);
});

test('the connection test, address save, Home switches and layout posts all pass the timeout', () => {
  for (const route of ['/test', '/config', '/allow', '/home-scenes', '/layout', '/dashboard']) {
    const line = src.split('\n').find(l => l.includes(`\${API}${route}\``) && /postJson/.test(l));
    assert.ok(line, `the ${route} post exists`);
    assert.match(line, /POST_TIMEOUT_MS\)/, `${route} passes the timeout`);
  }
});

test('no post in the file is left without a timeout argument', () => {
  const posts = src.split('\n').filter(l => /postJson</.test(l) && !/^(export )?async function|^export /.test(l.trim()));
  for (const l of posts) assert.match(l, /POST_TIMEOUT_MS\)|POST_TIMEOUT_MS\)\s*\}?/, `post passes the timeout: ${l.trim().slice(0, 70)}`);
});
