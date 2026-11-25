// The host's state files follow its port (host/host.ts), and --no-cast clears casting (src/core/server/config.ts). Run with: npm test
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { test } from 'node:test';

const CONFIG = resolve('src/core/server/config.ts');

/** Load config.ts in a fresh process with the given arguments, and return its cast setting. */
function castWith(args: string[]): string {
  const script = `process.argv.splice(1, 0, 'x'); import(${JSON.stringify(pathToFileURL(CONFIG).href)}).then(m => process.stdout.write(JSON.stringify(m.config.cast)))`;
  return JSON.parse(execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', script, '--', ...args], { encoding: 'utf8' }));
}

test('--no-cast turns casting off', () => {
  assert.equal(castWith(['--no-cast']), '');
});

test('without --no-cast the cast setting is read as before', () => {
  assert.equal(castWith(['--cast', '10.0.0.65']), '10.0.0.65');
});
