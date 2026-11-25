// The autostart script for the host's Windows Startup folder (host/host.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startupScript } from '../host/host.ts';

test('the startup script starts node on host.ts minimized, with both paths quoted', () => {
  const text = startupScript('C:\Program Files\nodejs\node.exe', 'C:\Users\me\Claude Home\host\host.ts');
  assert.match(text, /^@echo off\r\n/);
  assert.ok(text.includes('start "ClaudeOS Host" /min "C:\Program Files\nodejs\node.exe" "C:\Users\me\Claude Home\host\host.ts"'));
});
