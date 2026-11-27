// A name, nickname or role save gives up on a PC that does not answer, and a late older save does not undo a newer one
// (src/apps/settings/web/index.ts saveProfile). The settings page talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function saveProfile(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the profile save has a timeout', () => {
  assert.match(src, /const PROFILE_TIMEOUT_MS = 20e3;/);
  assert.match(body, /postJson<Partial<Profile>>\('\/api\/settings\/profile', fields, PROFILE_TIMEOUT_MS\)/);
});

test('each save takes the next number, and both paths drop a save that is no longer the newest', () => {
  assert.match(body, /const seq = \+\+profileSaveSeq;/);
  const guards = body.match(/if \(seq !== profileSaveSeq\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
  assert.ok(body.indexOf('if (seq !== profileSaveSeq) return;') < body.indexOf('applyProfile('), 'the check comes before the profile is applied');
});
