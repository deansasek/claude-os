// The place a hardware volume change shows (src/core/web/volume-target.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { volumeTarget } from '../src/core/web/volume-target.ts';

test('the drawer open takes the change on its slider', () => {
  assert.equal(volumeTarget(true, 1000, 0), 'slider');
});

test('the drawer closed shows the HUD', () => {
  assert.equal(volumeTarget(false, 1000, 0), 'hud');
});

test('the drawer closed inside a quiet window shows nothing', () => {
  assert.equal(volumeTarget(false, 1000, 2000), 'none');
});

test('the drawer open inside a quiet window still moves its slider', () => {
  assert.equal(volumeTarget(true, 1000, 2000), 'slider');
});
