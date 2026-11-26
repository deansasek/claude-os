// Home's scene button says why a scene did not set (src/apps/home/web/scene-words.ts).
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isOffHome, sceneActsAfterRead, sceneFailText } from '../src/apps/home/web/scene-words.ts';

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

// Voice ("set movie night") says the same sentence as Home's button. sceneCommand in voice-commands.ts is not
// importable in node (it pulls in dom.ts), so these cases pin sceneFailText, the function it now calls with the
// null (no answer) or refused result.
test('voice: no answer from the PC gives the PC sentence, not "Couldn’t set"', () => {
  const say = sceneFailText('Movie night', null);
  assert.equal(say, 'The PC isn’t answering, so Movie night didn’t change.');
  assert.equal(say.startsWith('Couldn’t set'), false);
});

test('voice: a refusal with a reason gives the reason in plain words', () => {
  assert.equal(sceneFailText('Movie night', { ok: false, error: 'request timed out' } as { error?: string }),
    'Couldn’t set Movie night. Home Assistant took too long to answer. Check that it is switched on.');
});

test('the reason text never carries raw HTML', () => {
  const out = sceneFailText('Movie night', { error: '<img src=x onerror=alert(1)>' });
  assert.equal(/[<>]/.test(out), false);
});

// Home's scene buttons after a read (loadScenes): an error answer keeps what is shown; a good answer replaces it.
const shown = [{ id: 'scene.movie', name: 'Movie night' }];
const scenesAnswer = {
  demo: false,
  scenes: [
    { entity_id: 'scene.reading', name: 'Reading', dashboard: false, home: true },
    { entity_id: 'scene.movie', name: 'Movie night', dashboard: false, home: true },
  ],
};

test('an error answer from the PC keeps the scene buttons already shown', () => {
  const r = { status: 'error' as const, home: [], scenes: [], demo: false, error: 'request timed out' };
  assert.deepEqual(sceneActsAfterRead(shown, r), shown);
});

test('an ok answer replaces the buttons with its picks, in order', () => {
  const r = { ...scenesAnswer, status: 'ok' as const, home: ['scene.reading', 'scene.movie'] };
  assert.deepEqual(sceneActsAfterRead(shown, r), [
    { id: 'scene.reading', name: 'Reading' },
    { id: 'scene.movie', name: 'Movie night' },
  ]);
});

test('a not_set_up answer clears the scene buttons', () => {
  const r = { status: 'not_set_up' as const, home: [], scenes: [], demo: false };
  assert.deepEqual(sceneActsAfterRead(shown, r), []);
});
