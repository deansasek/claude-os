// Focus modes (src/core/web/focus-modes.ts): what a mode sets, and which apps it hides. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { focusMode, hiddenApps, modeSettings } from '../src/core/web/focus-modes.ts';

test('Sleep turns Do Not Disturb on and hides the apps it names', () => {
  const s = modeSettings('sleep');
  assert.equal(s['os.dnd'], '1');
  assert.equal(s['os.banners'], '0');
  assert.equal(s['os.focusMode'], 'sleep');
  assert.deepEqual(JSON.parse(s['os.focusApps'] ?? 'null'), ['browser', 'photos', 'home-assistant', 'calendar', 'radio']);
});

test('Work keeps banners on and chimes off', () => {
  const s = modeSettings('work');
  assert.equal(s['os.dnd'], '0');
  assert.equal(s['os.banners'], '1');
  assert.equal(s['os.chimes'], '0');
});

test('turning focus off restores notifications and removes the hidden apps', () => {
  const s = modeSettings(null);
  assert.deepEqual(s, { 'os.dnd': '0', 'os.banners': '1', 'os.chimes': '1', 'os.focusApps': null, 'os.focusMode': null });
});

test('an unknown mode is the same as no mode', () => {
  assert.equal(focusMode('nap'), null);
  assert.deepEqual(modeSettings('nap'), modeSettings(null));
});

test('hiddenApps never hides the apps that must stay', () => {
  assert.deepEqual(hiddenApps('["photos","home","claude",5,"radio"]'), ['photos', 'radio']);
  assert.deepEqual(hiddenApps('not json'), []);
  assert.deepEqual(hiddenApps(null), []);
});
