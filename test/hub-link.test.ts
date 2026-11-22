// The PC-reachability state the tablet's status bar and Settings read. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hubReachable, onHubReachable, reportHubCheck } from '../src/core/web/hub-link.ts';

test('one missed check is a blip; two in a row mean the PC is away', () => {
  reportHubCheck(true);
  assert.equal(hubReachable(), true);
  reportHubCheck(false);
  assert.equal(hubReachable(), true);
  reportHubCheck(false);
  assert.equal(hubReachable(), false);
});

test('one successful check brings the PC back and tells the listeners once per change', () => {
  let calls = 0;
  onHubReachable(() => { calls++; });
  reportHubCheck(false);   // already down: no change, no call
  assert.equal(hubReachable(), false);
  const before = calls;
  reportHubCheck(true);
  assert.equal(hubReachable(), true);
  assert.equal(calls, before + 1);
  reportHubCheck(true);    // still up: no call
  assert.equal(calls, before + 1);
});
