// A plugin Check answer shows only on the plugin that asked, and a second tap while a check runs sends no second check
// (src/apps/settings/web/plugins.ts testOne). The Settings page is DOM code, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/settings/web/plugins.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function testOne(): Promise<void> {');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('testOne skips a second check for the same plugin while one runs, and clears its flag', () => {
  assert.ok(start > 0, 'testOne() exists');
  assert.match(src, /let testing: string \| null = null;/);
  assert.match(body, /if \(testing === key\) return;\s*testing = key;/);
  assert.match(body, /finally \{\s*if \(testing === key\) testing = null;\s*\}/);
});

test('every status line goes through the open-plugin check, so a late answer cannot land on another plugin', () => {
  assert.match(body, /const say = \(text: string\): void => \{ if \(openKey === key\) \$\('stPlugStatus'\)\.textContent = text; \};/);
  const writes = body.match(/\$\('stPlugStatus'\)\.textContent =/g) ?? [];
  assert.equal(writes.length, 1, 'the only direct write to the status line is inside say()');
});
