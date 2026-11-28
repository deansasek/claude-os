// "Clear the ticked items" says so when none is ticked (src/core/web/voice-commands.ts). The command handler needs the
// browser, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a clear that removed nothing says there is nothing ticked, before it says it cleared', () => {
  assert.match(src, /if \(r\.removed === 0\) return \{ say: `There’s nothing ticked on \$\{name\}\.` \};/);
  assert.ok(src.indexOf('r.removed === 0') < src.indexOf('Cleared the ticked items on ${name}.`, react'));
});
