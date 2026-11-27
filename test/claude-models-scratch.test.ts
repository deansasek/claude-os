// The Claude model list falls back, and asks again later, when the PC cannot make its scratch folder (src/apps/claude/server/turns.ts
// listModels). The state folder holds a plain file named workspace, so mkdir fails. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-models-'));
fs.writeFileSync(path.join(dir, 'workspace'), 'a file, not a folder');
process.env.CLAUDEOS_STATE_DIR = dir;
const { listModels } = await import('../src/apps/claude/server/turns.ts');

test('a scratch folder the PC cannot make gives the fallback list, and a second ask does not fail', async () => {
  const first = await listModels();
  const second = await listModels();
  assert.equal(first.source, 'fallback');
  assert.equal(second.source, 'fallback');
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));
