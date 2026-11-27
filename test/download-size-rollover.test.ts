// A download just under 1 MB reads 1.0 MB, not 1024 KB (the size copies in src/apps/browser/web/downloads.ts and state.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runningMeta } from '../src/apps/browser/web/downloads.ts';

test('a running download just under 1 MB reads 1.0 MB, not 1024 KB', () => {
  assert.equal(runningMeta(1048500, 0).text, '1.0 MB so far');
  assert.equal(runningMeta(1047000, 0).text, '1022 KB so far');
});

test('the Downloads panel copy of the size rule has the same cut-off', () => {
  const state = readFileSync(new URL('../src/apps/browser/web/state.ts', import.meta.url), 'utf8');
  assert.match(state, /if \(bytes < 1023\.5 \* 1024\) return `\$\{Math\.round\(bytes \/ 1024\)\} KB`;/);
});
