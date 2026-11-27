// The Settings plugin marketplace read gives up on a PC that does not answer, so the loading flag clears and Discover reads again
// (src/apps/settings/web/market.ts loadMarket). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/market.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function loadMarket(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the marketplace read has a 20 second timeout', () => {
  assert.match(src, /const MARKET_TIMEOUT_MS = 20e3;/);
  assert.match(body, /getJson<MarketView>\('\/api\/settings\/plugins\/market', MARKET_TIMEOUT_MS\)/);
});

test('the loading flag is cleared in finally, so a read that fails or times out still frees Discover', () => {
  assert.match(body, /finally \{ loading = false; \}/);
});
