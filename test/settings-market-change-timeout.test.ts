// A plugin install, remove or update check gives up only after the PC's own 120 s limit, so Install, Remove and Check for updates
// work again (src/apps/settings/web/market.ts post). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const market = readFileSync(path.join(root, 'src/apps/settings/web/market.ts'), 'utf8').replace(/\r\n/g, '\n');
const server = readFileSync(path.join(root, 'src/apps/settings/server/market.ts'), 'utf8').replace(/\r\n/g, '\n');

test('the change timeout is longer than the PC CLI limit', () => {
  const tablet = Number(market.match(/const CHANGE_TIMEOUT_MS = ([\d.e]+);/)?.[1]);
  const pc = Number(server.match(/const TIMEOUT_MS = ([\d.e]+);/)?.[1]);
  assert.ok(tablet > 0, 'CHANGE_TIMEOUT_MS is defined');
  assert.ok(pc > 0, 'the PC limit is defined');
  assert.ok(tablet > pc, `the tablet waits ${tablet} ms, longer than the PC's ${pc} ms`);
});

test('the change post passes the timeout, and a failed post still says network', () => {
  const start = market.indexOf('async function post(');
  const body = market.slice(start, market.indexOf('\n}\n', start));
  assert.match(body, /postJson<MarketResult>\(`\/api\/settings\/plugins\/market\/\$\{path\}`, body, CHANGE_TIMEOUT_MS\)/);
  assert.match(body, /error: 'network'/);
});
