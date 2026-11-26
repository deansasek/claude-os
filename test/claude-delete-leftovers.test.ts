// Deleting a Claude session removes its leftover folders; one that cannot be removed does not stop the others. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-leftovers-'));
process.env.CLAUDEOS_STATE_DIR = path.join(root, 'state');
after(() => fs.rmSync(root, { recursive: true, force: true }));
const { removeLeftovers } = await import('../src/apps/claude/server/manage.ts');

const id = 'sess-leftover-1';
function folder(name: string): string {
  const p = path.join(root, name, id);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'keep.txt'), 'x');
  return p;
}

test('a leftover folder that cannot be removed does not stop the others', () => {
  const a = folder('a'), b = folder('b'), c = folder('c');
  const busy = (p: string) => { if (p === b) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); fs.rmSync(p, { recursive: true, force: true }); };
  assert.doesNotThrow(() => removeLeftovers([a, b, c], id, busy));
  assert.equal(fs.existsSync(a), false, 'the first folder is removed');
  assert.equal(fs.existsSync(c), false, 'the folder after the failed one is removed');
  assert.equal(fs.existsSync(b), true, 'the busy folder is left in place');
});

test('a path not named for the session id is never removed', () => {
  const other = path.join(root, 'other-session');
  fs.mkdirSync(other, { recursive: true });
  removeLeftovers([other], id);
  assert.equal(fs.existsSync(other), true);
});
