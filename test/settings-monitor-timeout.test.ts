// The Settings system monitor's status read gives up on a PC that does not answer, and a late older repaint does not draw over a newer one
// (src/apps/settings/web/index.ts paintMonitor). The settings page talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function paintMonitor(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the status read has a 20 second timeout', () => {
  assert.match(src, /const MONITOR_TIMEOUT_MS = 20e3;/);
  assert.match(body, /getJson<\{ uptimeSeconds: number \}>\('\/api\/core\/status', MONITOR_TIMEOUT_MS\)/);
});

test('the repaint takes the next number before the read, and the check comes before the rows are drawn', () => {
  assert.ok(body.indexOf('const n = ++monitorSeq;') >= 0, 'the number is taken');
  assert.ok(body.indexOf('const n = ++monitorSeq;') < body.indexOf('await getJson'), 'the number is taken before the read');
  const guard = body.indexOf('if (n !== monitorSeq) return;');
  assert.ok(guard > 0, 'the check exists');
  assert.ok(guard < body.indexOf("$('stMonUptime')"), 'the check comes before the uptime is drawn');
  assert.ok(guard < body.indexOf("$('stMonOpen')"), 'the check comes before the open apps are drawn');
});
