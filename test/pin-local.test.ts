// The tablet's own PIN check (src/core/web/pin-local.ts and pbkdf2.ts) against node:crypto, the PC's own hash. Run with: npm test
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { pbkdf2Hex, sha256 } from '../src/core/web/pbkdf2.ts';
import { applyGuess, keepCopyAfterUnlock, localRecord, matchesRecord, type LocalState } from '../src/core/web/pin-local.ts';

const FRESH: LocalState = { fails: 0, lockedUntil: 0 };

test('sha256 matches node:crypto for every length around the 64-byte block edge', () => {
  for (let n = 0; n <= 200; n++) {
    const data = crypto.randomBytes(n);
    assert.equal(Buffer.from(sha256(new Uint8Array(data))).toString('hex'), crypto.createHash('sha256').update(data).digest('hex'), `length ${n}`);
  }
});

test('pbkdf2Hex matches the PC hash (node pbkdf2Sync) for the PC parameters', () => {
  const salt = crypto.randomBytes(16).toString('hex');
  const want = crypto.pbkdf2Sync('1234', Buffer.from(salt, 'hex'), 200000, 32, 'sha256').toString('hex');
  assert.equal(pbkdf2Hex('1234', salt, 200000), want);
});

test('matchesRecord accepts the right PIN and refuses a wrong one', () => {
  const salt = crypto.randomBytes(16).toString('hex');
  const rec = { salt, iterations: 1000, hash: crypto.pbkdf2Sync('5678', Buffer.from(salt, 'hex'), 1000, 32, 'sha256').toString('hex') };
  assert.equal(matchesRecord(rec, '5678'), true);
  assert.equal(matchesRecord(rec, '5679'), false);
});

test('five wrong tries start a 30-second cooldown, the right PIN is refused until it ends', () => {
  let st = FRESH;
  const now = 1_000_000;
  for (let n = 1; n <= 4; n++) {
    const r = applyGuess(st, false, now);
    assert.deepEqual(r.result, { ok: false, error: 'wrong', left: 5 - n, lockedFor: 0 });
    st = r.state;
  }
  const fifth = applyGuess(st, false, now);
  assert.deepEqual(fifth.result, { ok: false, error: 'locked', lockedFor: 30 });
  st = fifth.state;
  assert.deepEqual(applyGuess(st, true, now + 29_999).result, { ok: false, error: 'locked', lockedFor: 1 });
  assert.deepEqual(applyGuess(st, true, now + 30_000).result, { ok: true, lockedFor: 0 });
});

test('a confirmed unlock makes the copy when the tablet has none, and keeps an existing one', async () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  try {
    assert.equal(localRecord(), null);
    await keepCopyAfterUnlock('1234');
    const first = localRecord();
    assert.ok(first, 'a copy is made');
    assert.equal(matchesRecord(first!, '1234'), true);
    assert.equal(matchesRecord(first!, '4321'), false);
    await keepCopyAfterUnlock('4321');   // a copy exists: it is not replaced
    assert.deepEqual(localRecord(), first);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test('a right PIN clears the wrong-try count', () => {
  const r1 = applyGuess(FRESH, false, 0);
  const r2 = applyGuess(r1.state, true, 0);
  assert.deepEqual(r2.state, FRESH);
  assert.deepEqual(applyGuess(r2.state, false, 0).result, { ok: false, error: 'wrong', left: 4, lockedFor: 0 });
});
