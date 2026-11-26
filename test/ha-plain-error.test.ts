// Home Assistant errors in one plain sentence: the PC-unreachable text keeps its own wording.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plain } from '../src/apps/home-assistant/api.ts';

test('a PC-unreachable message keeps its own wording', () => {
  assert.equal(plain('Can’t reach the PC right now.'), 'Can’t reach the PC right now.');
});

test('a connection refused error gives the address sentence', () => {
  assert.equal(plain('ECONNREFUSED'), 'Couldn’t reach Home Assistant. Check the address in Settings, and that it is on the same network.');
});

test('a 401 error gives the token sentence', () => {
  assert.equal(plain('401'), 'The access token was refused. Replace it in Settings, then Apps, then Home Assistant.');
});

test('a timeout gives the slow-answer sentence', () => {
  assert.equal(plain('timeout'), 'Home Assistant took too long to answer. Check that it is switched on.');
});
