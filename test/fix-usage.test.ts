// Tests for the usage summary line. formatUsage is pure; the CLI test uses a temp RUNNER_TEMP. Run with: npm test
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { FAILED, NO_DATA, formatUsage } from '../scripts/fix-usage.ts';

const SCRIPT = fileURLToPath(new URL('../scripts/fix-usage.ts', import.meta.url));

test('formatUsage writes the totals, cache split, turns and cost for a normal result', () => {
  const raw = { usage: { input_tokens: 1000, output_tokens: 340, cache_creation_input_tokens: 500, cache_read_input_tokens: 2000 }, num_turns: 3, total_cost_usd: 0.4567 };
  assert.equal(formatUsage(raw).line,
    'Usage: 3,840 tokens (input 1,000, output 340, cache written 500, cache read 2,000, 57% cache hit) · 3 turn(s) · $0.46');
});

test('formatUsage computes the cache hit share over input, cache written and cache read', () => {
  const hit = (input: number, cw: number, cr: number): string =>
    formatUsage({ usage: { input_tokens: input, cache_creation_input_tokens: cw, cache_read_input_tokens: cr } }).line;
  assert.match(hit(100, 0, 300), /, 75% cache hit\)/);
  assert.match(hit(1, 0, 2), /, 67% cache hit\)/);
  assert.match(hit(0, 0, 0), /, 0% cache hit\)/);
});

test('formatUsage falls back to zeros when the result has no usage key', () => {
  assert.equal(formatUsage([{ num_turns: 2, total_cost_usd: 0.1 }]).line,
    'Usage: 0 tokens (input 0, output 0, cache written 0, cache read 0, 0% cache hit) · 2 turn(s) · $0.10');
});

test('formatUsage returns the no-data line when there is no output file', () => {
  assert.equal(formatUsage(undefined).line, NO_DATA);
  assert.equal(NO_DATA, 'No usage data was recorded for this run.');
});

test('formatUsage uses the last object with usage in an array', () => {
  const raw = [
    { usage: { input_tokens: 9 }, num_turns: 4, total_cost_usd: 2.5 },
    { usage: { input_tokens: 5 }, num_turns: 1, total_cost_usd: 1 },
    { type: 'system' },
  ];
  assert.equal(formatUsage(raw).line,
    'Usage: 5 tokens (input 5, output 0, cache written 0, cache read 0, 0% cache hit) · 1 turn(s) · $1.00');
});

test('the script prints the failed line and exits 0 when the output file is not JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fix-usage-'));
  writeFileSync(join(dir, 'claude-execution-output.json'), '{not json');
  const run = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: '' },
  });
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), FAILED);
});
