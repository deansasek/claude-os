// The power menu's buttons (src/core/web/power-sheet.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { powerStep } from '../src/core/web/power-sheet.ts';

test('Restart asks first, then restarts', () => {
  assert.deepEqual(powerStep('menu', 'restart'), { next: 'confirm', call: null });
  assert.deepEqual(powerStep('confirm', 'restart'), { next: null, call: 'reboot' });
});

test('Turn off screen turns the screen off at once and closes the menu', () => {
  assert.deepEqual(powerStep('menu', 'screen-off'), { next: null, call: 'screenOff' });
});

test('Screenshot closes the menu and asks the tablet for a screenshot', () => {
  assert.deepEqual(powerStep('menu', 'screenshot'), { next: null, call: 'screenshot' });
});

test('Cancel closes the menu and calls nothing', () => {
  assert.deepEqual(powerStep('menu', 'cancel'), { next: null, call: null });
  assert.deepEqual(powerStep('confirm', 'cancel'), { next: null, call: null });
});
