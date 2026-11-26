// Home's scene button says why a scene did not set (src/apps/home/web/scene-words.ts).
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isOffHome, sceneFailText } from '../src/apps/home/web/scene-words.ts';

test('no answer from the PC says the PC is not answering', () => {
  assert.equal(sceneFailText('Movie night', null), 'The PC isn’t answering, so Movie night didn’t change.');
});

test('a scene that is no longer on Home says so, and is flagged for a reload', () => {
  const r = { ok: false, error: 'Movie night isn’t on Home.' };
  assert.equal(isOffHome(r), true);
  assert.equal(sceneFailText('Movie night', r), 'Movie night isn’t on Home any more.');
});

test('a refused token gets the plain token sentence, not the raw error', () => {
  const r = { error: '401 Unauthorized' };
  assert.equal(isOffHome(r), false);
  assert.equal(sceneFailText('Movie night', r),
    'Couldn’t set Movie night. The access token was refused. Replace it in Settings, then Apps, then Home Assistant.');
});

test('a timeout gets the plain timeout sentence', () => {
  assert.equal(sceneFailText('Movie night', { error: 'request timed out' }),
    'Couldn’t set Movie night. Home Assistant took too long to answer. Check that it is switched on.');
});

test('a failure with no reason still gives a plain sentence', () => {
  assert.equal(sceneFailText('Movie night', { error: undefined }),
    'Couldn’t set Movie night. Something went wrong. Try again in a moment.');
});

test('the reason text never carries raw HTML', () => {
  const out = sceneFailText('Movie night', { error: '<img src=x onerror=alert(1)>' });
  assert.equal(/[<>]/.test(out), false);
});
