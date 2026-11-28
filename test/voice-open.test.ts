// Opening an app by voice (src/core/web/voice-open.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchOpenApp } from '../src/core/web/voice-open.ts';

const id = (t: string) => matchOpenApp(t)?.id ?? null;

test('each app opens by its name', () => {
  assert.equal(id('open meals'), 'meals');
  assert.equal(id('show the calculator'), 'calculator');
  assert.equal(id('open sketch'), 'sketch');
  assert.equal(id("what's for dinner tonight"), null);   // a dinner question is the Meals command, not an open
  assert.equal(id('open photos'), 'photos');
  assert.equal(id('show the calendar'), 'calendar');
  assert.equal(id('go to weather'), 'weather');
  assert.equal(id('open home assistant'), 'home-assistant');
  assert.equal(id('open settings'), 'settings');
  assert.equal(id('open clock'), 'clock');
  assert.equal(id('open lists'), 'lists');
  assert.equal(id('open routines'), 'routines');
  assert.equal(id('open camera'), 'camera');
  assert.equal(id('open browser'), 'browser');
  assert.equal(id('open claude'), 'claude');
  assert.equal(id('open apps'), 'launcher');
  assert.equal(id('open home'), 'home');
  assert.equal(id('open the news'), 'news');
  assert.equal(id('show me the news'), 'news');
  assert.equal(id('open radio'), 'radio');
  assert.equal(id('open recipes'), 'recipes');
});

test('"the", "my", "app" and the other verbs are allowed', () => {
  assert.equal(id('open the photos app'), 'photos');
  assert.equal(id('show me the home assistant app'), 'home-assistant');
  assert.equal(id('switch to my calendar'), 'calendar');
  assert.equal(id('take me to the settings screen'), 'settings');
  assert.equal(id('open up the camera'), 'camera');
  assert.equal(id('go home'), 'home');
  assert.equal(id('home screen'), 'home');
});

test('the name said back is the app name', () => {
  assert.equal(matchOpenApp('open photos')?.name, 'Photos');
  assert.equal(matchOpenApp('open home assistant')?.name, 'Home Assistant');
  assert.equal(matchOpenApp('open apps')?.name, 'Apps');
});

test('phrases that are not exactly one app name are left to the other commands', () => {
  assert.equal(id('open the lights'), null);
  assert.equal(id('open the shopping list'), null);
  assert.equal(id('show the shopping list'), null);
  assert.equal(id('open the garage door'), null);
  assert.equal(id('open photos and weather'), null);
  assert.equal(id('go to sleep'), null);
  assert.equal(id('open'), null);
  assert.equal(id('photos'), null);
  assert.equal(id('open constructor'), null);
  assert.equal(id('open the the photos'), null);
});
