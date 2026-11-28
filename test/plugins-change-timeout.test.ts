// A Settings plugin switch, test, add or remove gives up on a PC that does not answer (src/apps/settings/web/plugins.ts).
// The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugins = readFileSync(path.join(root, 'src/apps/settings/web/plugins.ts'), 'utf8').replace(/\r\n/g, '\n');
const server = readFileSync(path.join(root, 'src/apps/settings/server/plugins.ts'), 'utf8').replace(/\r\n/g, '\n');

test('every plugin post passes a timeout', () => {
  // each postJson call is checked up to its closing paren; the multi-line add call runs to its "});"
  const starts = [...plugins.matchAll(/postJson</g)].map(m => m.index as number);
  assert.equal(starts.length, 6, `found ${starts.length} plugin posts`);
  // the window after each post runs to its own closing paren (the add call spans several lines)
  for (const from of starts) {
    const c = plugins.slice(from, from + 400);
    assert.match(c, /_TIMEOUT_MS\)/, `post passes a timeout: ${c.slice(0, 60)}`);
  }
});

test('the test probe waits longer than the PC probe, so a real check is not cut off', () => {
  const tablet = Number(plugins.match(/const PLUGINS_TIMEOUT_MS = ([\d_e.]+);/)?.[1]?.replace(/_/g, ''));
  const pc = Number(server.match(/const PROBE_MS = ([\d.e]+);/)?.[1]);
  assert.ok(tablet > pc, `the tablet waits ${tablet} ms, longer than the PC probe ${pc} ms`);
});
