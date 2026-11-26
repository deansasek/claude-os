// The initials on the avatar (src/core/web/profile.ts). The profile module fetches the PC when it loads, so the test
// gives it a page location and a fetch that fails at once. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

Object.assign(globalThis, { location: { search: '' } });
globalThis.fetch = (async () => { throw new TypeError('no PC in the test'); }) as typeof fetch;
const { initials } = await import('../src/core/web/profile.ts');

test('initials are the first letters of the first and last words', () => {
  assert.equal(initials('dean sasek'), 'DS');
  assert.equal(initials('Dean'), 'DE');
  assert.equal(initials('   '), '');
});

test('an emoji or another astral letter stays whole in the initials', () => {
  assert.equal(initials('😀 Dean'), '😀D');
  assert.equal(initials('𝓓ean'), '𝓓E');
});
