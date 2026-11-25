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
  // Windows git also writes these two keys. The allowlist does not list them, so remove them here.
  for (const key of ['core.symlinks', 'core.ignorecase']) spawnSync('git', ['config', '--local', '--unset', key], { cwd: dir });
  const prPath = join(dir, 'pr.md');
  writeFileSync(prPath, 'fix(clock): timer resets\n\n## Why\nx.\n\n## What\nx.\n\n## Tests\nx.\n');
  return { dir, prPath };
};

const runShip = (dir: string, prPath: string, env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [SHIP, '5', prPath], { cwd: dir, encoding: 'utf8', env: { ...process.env, FIX_SHIP_DRY: '1', FIX_SHIP_LIB: '', ...env } });

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

test('fix-ship allows the four actions/checkout includeif keys when the value is under RUNNER_TEMP', () => {
  const { dir, prPath } = scratchRepo();
  const runnerTemp = mkdtempSync(join(tmpdir(), 'fix-ship-runner-'));
  const credentials = `${runnerTemp}/git-credentials.config`.replace(/\\/g, '/');
  const workspace = dir.replace(/\\/g, '/');
  const gitdirs = [`${workspace}/.git`, `${workspace}/.git/worktrees/wt1`,
    '/github/workspace/.git', '/github/workspace/.git/worktrees/wt1'];
  for (const gitdir of gitdirs) {
    execFileSync('git', ['config', '--local', `includeif.gitdir:${gitdir}.path`, credentials], { cwd: dir });
  }
  const result = runShip(dir, prPath, { RUNNER_TEMP: runnerTemp, GITHUB_WORKSPACE: dir });
  assert.doesNotMatch(result.stderr, /git-config/);
});

const refusesConfigKey = (name: string, args: string[], key: string) => test(name, () => {
  const { dir, prPath } = scratchRepo();
  execFileSync('git', ['config', '--local', ...args], { cwd: dir });
  const result = runShip(dir, prPath);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /git-config/);
  assert.ok(result.stderr.includes(key), `stderr names ${key}`);
});

refusesConfigKey('fix-ship refuses an includeif for another gitdir',
  ['includeif.gitdir:/other/repo/.git.path', '/github/runner_temp/git-credentials.config'], 'includeif.gitdir:/other/repo/.git.path');
refusesConfigKey('fix-ship refuses include.path',
  ['include.path', '/github/runner_temp/evil.config'], 'include.path');
refusesConfigKey('fix-ship refuses url.x.insteadof',
  ['url.x.insteadof', 'https://evil.example/'], 'url.x.insteadof');
refusesConfigKey('fix-ship refuses gpg.program',
  ['gpg.program', '/tmp/evil'], 'gpg.program');
refusesConfigKey('fix-ship refuses credential.helper',
  ['credential.helper', 'store'], 'credential.helper');
refusesConfigKey('fix-ship refuses an unknown git config key',
  ['some.unknown', 'value'], 'some.unknown');

// --pr mode: the pure checks. FIX_SHIP_LIB keeps the CLI from running on import. It is unset again so the spawned runs above still run the CLI.
process.env.FIX_SHIP_LIB = '1';
const { prRefusal, testScript } = await import('../scripts/fix-ship.ts');
delete process.env.FIX_SHIP_LIB;

const SAME_REPO = { headRefName: 'feat/fix', headRepository: { nameWithOwner: 'deansasek/claude-os' }, baseRepository: { nameWithOwner: 'deansasek/claude-os' } };

test('fix-ship --pr refuses a PR from a fork', () => {
  const fork = { ...SAME_REPO, headRepository: { nameWithOwner: 'someone/claude-os' } };
  assert.equal(prRefusal(fork, ['src/a.ts'], undefined, undefined)?.rule, 'fork');
  assert.equal(prRefusal({ ...SAME_REPO, headRepository: null }, ['src/a.ts'], undefined, undefined)?.rule, 'fork');
});

test('fix-ship --pr refuses when the working tree has no changes', () => {
  assert.equal(prRefusal(SAME_REPO, [], undefined, undefined)?.rule, 'no-changes');
});

test('fix-ship --pr refuses a protected path and names the file', () => {
  for (const file of ['.github/workflows/claude.yml', '.claude/settings.json', 'scripts/fix-gate.ts']) {
    const refused = prRefusal(SAME_REPO, ['src/a.ts', file], undefined, undefined);
    assert.equal(refused?.rule, 'protected-path');
    assert.ok(refused?.reason.includes(file), `reason names ${file}`);
  }
});

test('fix-ship --pr refuses a package.json change to the test script only', () => {
  assert.equal(prRefusal(SAME_REPO, ['package.json'], 'node --test a.ts', 'node --test a.ts b.ts')?.rule, 'protected-path');
  assert.equal(prRefusal(SAME_REPO, ['package.json'], 'node --test a.ts', 'node --test a.ts'), undefined);
});

test('fix-ship --pr allows an ordinary source change on a same-repo PR', () => {
  assert.equal(prRefusal(SAME_REPO, ['src/apps/clock/web/view.ts'], undefined, undefined), undefined);
});

test('fix-ship testScript reads the test script from package.json text', () => {
  assert.equal(testScript('{"scripts":{"test":"node --test"}}'), 'node --test');
  assert.equal(testScript('{}'), undefined);
});
