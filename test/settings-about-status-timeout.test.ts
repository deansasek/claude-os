// The Settings About status read gives up on a PC that does not answer, and a late older repaint does not paint an older uptime
// (src/apps/settings/web/index.ts paintAbout). The settings page talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('function paintAbout(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the status read has a 20 second timeout', () => {
  assert.match(src, /const ABOUT_TIMEOUT_MS = 20e3;/);
  assert.match(body, /getJson<\{ uptimeSeconds: number \}>\('\/api\/core\/status', ABOUT_TIMEOUT_MS\)/);
});

test('each repaint takes the next number before the read, and the check comes before the uptime is written', () => {
  assert.ok(body.indexOf('const n = ++aboutSeq;') >= 0, 'the number is taken');
  assert.ok(body.indexOf('const n = ++aboutSeq;') < body.indexOf('getJson<'), 'the number is taken before the read');
  const guard = body.indexOf('if (n !== aboutSeq) return;');
  assert.ok(guard > 0, 'the check exists');
  assert.ok(guard < body.indexOf('running ${uptimeText'), 'the check comes before the uptime is written');
});
