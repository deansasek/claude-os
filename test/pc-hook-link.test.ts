// The PC link hook: install names the hub's state folder in each hook command (so a hook run by Claude Code finds the
// link file even when CLAUDEOS_STATE_DIR is not in its environment). Runs the real script on temp folders.
// Run with: npm test
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const HOST_DIR = path.resolve(import.meta.dirname, '..');

test('install writes the state folder into the hook commands', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pchook-home-'));
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'pchook-state-'));
  try {
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(HOST_DIR, 'scripts', 'claude-os-pc-hook.ts'), 'install'], {
      env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDEOS_STATE_DIR: state }, stdio: 'pipe',
    });
    const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
    const commands: string[] = [...settings.hooks.Stop, ...settings.hooks.PermissionRequest].flatMap((e: { hooks: { command: string }[] }) => e.hooks.map(h => h.command));
    assert.equal(commands.length, 2);
    const want = path.join(state, '.pc-bridge.json').split(path.sep).join('/');   // the hook command uses forward slashes
    for (const c of commands) assert.ok(c.includes(want), c);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(state, { recursive: true, force: true });
  }
});
