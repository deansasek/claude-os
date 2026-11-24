// Unit tests for the AI issue-fix gate rules. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gate, isDeniedPath, isPackageJsonChangeAllowed } from '../scripts/fix-gate.ts';
import type { FileChange, GateInput } from '../scripts/fix-gate.ts';

const good: FileChange = { path: 'src/apps/clock/web/view.ts', added: 10, deleted: 2 };
const goodTitle = 'fix(clock): timer resets after a lap';
const goodBody = '## Why\nThe timer resets.\n\n## What\nEdits the clock view.\n\n## Tests\nnpm test.\n';
const input = (over: Partial<GateInput> = {}): GateInput => ({ files: [good], title: goodTitle, body: goodBody, ...over });

const BASE_TEST = 'node --test --disable-warning=ExperimentalWarning test/a.test.ts test/b.test.ts';
const pkg = (test: string, extra: Record<string, unknown> = {}, scripts: Record<string, string> = {}): string =>
  JSON.stringify({ name: 'x', scripts: { check: 'tsc -p .', ...scripts, test }, devDependencies: {}, ...extra });

test('isDeniedPath blocks each protected path', () => {
  const denied = [
    '.github/workflows/pr-checks.yml', '.claude/settings.json', 'CLAUDE.md', '.mcp.json', 'host/ClaudeHubHost.ts',
    'scripts/check-test-list.ts', 'tsconfig.json', 'android/.npmrc', '.npmrc', 'package-lock.json',
    'android/release.jks', 'android/debug.keystore', 'android/keystore.properties', 'host\\hubctl.ts',
  ];
  for (const path of denied) assert.equal(isDeniedPath(path), true, path);
});

test('isDeniedPath allows ordinary app and test paths', () => {
  assert.equal(isDeniedPath('src/apps/clock/web/view.ts'), false);
  assert.equal(isDeniedPath('test/fix-gate.test.ts'), false);
  assert.equal(isDeniedPath('scripts/fix-gate.ts'), false);
  assert.equal(isDeniedPath('package.json'), false);
});

test('gate rejects a denied path and names the rule', () => {
  const result = gate(input({ files: [{ path: '.github/workflows/x.yml', added: 1, deleted: 0 }] }));
  assert.equal(result.pass, false);
  assert.equal(result.rule, 'denied-path');
});

test('isPackageJsonChangeAllowed accepts added test file names only', () => {
  const after = pkg(`${BASE_TEST} test/fix-gate.test.ts`);
  assert.equal(isPackageJsonChangeAllowed(pkg(BASE_TEST), after), true);
  assert.equal(isPackageJsonChangeAllowed(pkg(BASE_TEST), pkg(BASE_TEST)), true);
});

test('isPackageJsonChangeAllowed refuses other package.json edits', () => {
  const before = pkg(BASE_TEST);
  assert.equal(isPackageJsonChangeAllowed(before, pkg(`${BASE_TEST} scripts/evil.ts`)), false);
  assert.equal(isPackageJsonChangeAllowed(before, pkg(BASE_TEST.replace(' test/b.test.ts', ''))), false);
  assert.equal(isPackageJsonChangeAllowed(before, pkg(BASE_TEST, { devDependencies: { x: '1.0.0' } })), false);
  assert.equal(isPackageJsonChangeAllowed(before, pkg(BASE_TEST, {}, { check: 'echo ok' })), false);
  assert.equal(isPackageJsonChangeAllowed(before, '{ not json'), false);
});

test('gate allows a package.json change that only adds a test name', () => {
  const pair = { before: pkg(BASE_TEST), after: pkg(`${BASE_TEST} test/fix-gate.test.ts`) };
  const result = gate(input({ files: [{ path: 'package.json', added: 1, deleted: 1 }], packageJson: pair }));
  assert.equal(result.pass, true);
});

test('gate rejects a package.json change that adds a script', () => {
  const pair = { before: pkg(BASE_TEST), after: pkg(BASE_TEST, {}, { lint: 'x' }) };
  const result = gate(input({ files: [{ path: 'package.json', added: 1, deleted: 1 }], packageJson: pair }));
  assert.equal(result.pass, false);
  assert.equal(result.rule, 'package-json');
});

test('gate rejects package.json when no old and new text is given', () => {
  const result = gate(input({ files: [{ path: 'package.json', added: 1, deleted: 1 }] }));
  assert.equal(result.rule, 'package-json');
});

test('gate rejects an empty change', () => {
  assert.equal(gate(input({ files: [] })).rule, 'no-change');
  assert.equal(gate(input({ files: [{ path: 'src/a.ts', added: 0, deleted: 0 }] })).rule, 'no-change');
});

test('gate rejects a symlink', () => {
  assert.equal(gate(input({ files: [{ ...good, symlink: true }] })).rule, 'symlink');
});

test('gate rejects more than 10 files', () => {
  const files = Array.from({ length: 11 }, (_, i) => ({ path: `src/apps/a/f${i}.ts`, added: 1, deleted: 0 }));
  assert.equal(gate(input({ files })).rule, 'file-count');
});

test('gate rejects more than 300 changed lines and allows exactly 300', () => {
  assert.equal(gate(input({ files: [{ path: 'src/a.ts', added: 301, deleted: 0 }] })).rule, 'line-count');
  assert.equal(gate(input({ files: [{ path: 'src/a.ts', added: 150, deleted: 150 }] })).pass, true);
});

test('gate passes a good change', () => {
  assert.deepEqual(gate(input()), { pass: true, rule: 'none', reason: 'all rules pass' });
});

test('gate rejects a PR title that is not Conventional Commits', () => {
  assert.equal(gate(input({ title: 'Fix clock' })).rule, 'pr-title');
  assert.equal(gate(input({ title: 'feat(Clock): add timer' })).rule, 'pr-title');
});

test('gate rejects a PR body that lacks a heading', () => {
  const body = goodBody.replace('## Tests\nnpm test.\n', '');
  const result = gate(input({ body }));
  assert.equal(result.rule, 'pr-body');
  assert.match(result.reason, /## Tests/);
});

test('gate rejects an AI attribution line in the body', () => {
  const body = `${goodBody}\nCo-Authored-By: Example <example@example.com>\n`;
  assert.equal(gate(input({ body })).rule, 'pr-attribution');
});
