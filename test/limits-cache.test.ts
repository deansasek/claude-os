// The Claude usage numbers are saved safely and read back at start (src/apps/claude/server/limits.ts saveLimitsCache). Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-limits-'));
process.env.CLAUDEOS_STATE_DIR = dir;
const cacheFile = path.join(dir, '.limits-cache.json');
fs.writeFileSync(cacheFile, JSON.stringify({ limits: { session: { pct: 42 } } }));
const { LIMITS, saveLimitsCache } = await import('../src/apps/claude/server/limits.ts');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('the saved numbers are read back when the hub starts', () => {
  assert.equal(Object.keys(LIMITS.limits).length, 1);
});

test('a save writes the file whole, and leaves no temp file behind', () => {
  saveLimitsCache();
  const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as { limits: Record<string, unknown> };
  assert.ok(saved.limits && typeof saved.limits === 'object');
  assert.equal(fs.existsSync(`${cacheFile}.tmp`), false);
});
