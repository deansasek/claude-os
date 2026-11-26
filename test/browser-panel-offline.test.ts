// A Browser reply that loses the PC says so while it waits (src/apps/browser/web/claude-panel.ts, watch).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/browser/web/claude-panel.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('function watch(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('a reply that loses the PC says so while it waits', () => {
  assert.ok(start > 0, 'watch() exists');
  const offline = /catch \{ statusHtml = `[^`]*Can’t reach your PC[^`]*`; paint\(\); timer = window\.setTimeout\(tick, 2000\); return; \}/;
  assert.match(body, offline);
  assert.ok(body.search(offline) < body.indexOf('setTimeout(tick, 2000'), 'the offline status is set before the retry is scheduled');
});
