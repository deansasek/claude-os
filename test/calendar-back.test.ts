// Hardware Back in the Calendar closes the topmost sheet (src/apps/calendar/web/edit.ts backTarget). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backTarget } from '../src/apps/calendar/web/edit.ts';

const none = { detail: false, picker: false, confirm: false, add: false };

test('nothing open gives null, so Back goes on to Home', () => {
  assert.equal(backTarget(none), null);
});

test('each sheet is closed in order: details, picker, confirm, then the add sheet', () => {
  assert.equal(backTarget({ ...none, detail: true }), 'detail');
  assert.equal(backTarget({ ...none, picker: true }), 'picker');
  assert.equal(backTarget({ ...none, confirm: true, add: true }), 'confirm');
  assert.equal(backTarget({ ...none, add: true }), 'add');
});

test('a picker over the add sheet closes before the sheet', () => {
  assert.equal(backTarget({ ...none, picker: true, add: true }), 'picker');
});

test('a confirm step whose add sheet is closed is not a Back target', () => {
  assert.equal(backTarget({ ...none, confirm: true }), null);
});
