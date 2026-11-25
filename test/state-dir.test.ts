// CLAUDEOS_STATE_DIR moves the host's state files (src/core/server/paths.ts). Run with: npm test
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const PATHS = resolve('src/core/server/paths.ts');

/** Load paths.ts in a fresh process with the given environment, and return STATE. */
function stateIn(env: Record<string, string | undefined>): string {
  const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e',
    `import(${JSON.stringify(pathToFileURL(PATHS).href)}).then(m => process.stdout.write(m.STATE))`], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return out.trim();
}

test('STATE defaults to the repository root when CLAUDEOS_STATE_DIR is not set', () => {
  assert.equal(stateIn({ CLAUDEOS_STATE_DIR: undefined }), resolve('.'));
});

test('STATE follows CLAUDEOS_STATE_DIR', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-dir-'));
  assert.equal(stateIn({ CLAUDEOS_STATE_DIR: dir }), resolve(dir));
});
