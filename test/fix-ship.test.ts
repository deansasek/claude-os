// Tests for the fix-ship refusal checks. They run before any git write. Run with: npm test
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SHIP = fileURLToPath(new URL('../scripts/fix-ship.ts', import.meta.url));

const scratchRepo = (): { dir: string; prPath: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'fix-ship-test-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const prPath = join(dir, 'pr.md');
  writeFileSync(prPath, 'fix(clock): timer resets\n\n## Why\nx.\n\n## What\nx.\n\n## Tests\nx.\n');
  return { dir, prPath };
};

const runShip = (dir: string, prPath: string) =>
  spawnSync(process.execPath, [SHIP, '5', prPath], { cwd: dir, encoding: 'utf8', env: { ...process.env, FIX_SHIP_DRY: '1' } });

test('fix-ship refuses a planted .git/hooks file before any git write', () => {
  const { dir, prPath } = scratchRepo();
  writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');
  const result = runShip(dir, prPath);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /git-hooks/);
  assert.match(result.stderr, /pre-commit/);
});

test('fix-ship refuses an unsafe local git config key', () => {
  const { dir, prPath } = scratchRepo();
  execFileSync('git', ['config', '--local', 'alias.evil', '!sh -c true'], { cwd: dir });
  const result = runShip(dir, prPath);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /git-config/);
});

test('fix-ship allows the runner core.fsmonitor setting, because every git call disables it', () => {
  const { dir, prPath } = scratchRepo();
  execFileSync('git', ['config', '--local', 'core.fsmonitor', 'true'], { cwd: dir });
  const result = runShip(dir, prPath);
  assert.doesNotMatch(result.stderr, /git-config/);
});
