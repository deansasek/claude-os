// The PC link: lets the tablet reply to, and answer permission prompts of, Claude Code sessions open on this PC
// (the CLI or the desktop app). See src/apps/claude/server/pclink.ts for how it works.
//
//   node scripts/claude-os-pc-hook.ts install     add the two hooks to ~/.claude/settings.json (a backup is kept next to it)
//   node scripts/claude-os-pc-hook.ts uninstall   remove them again
//   node scripts/claude-os-pc-hook.ts stop        (run by Claude Code) the background Stop hook
//   node scripts/claude-os-pc-hook.ts permission  (run by Claude Code) the PermissionRequest hook
//
// Sessions already open load the hooks once they are reopened. The hooks do nothing in turns the hub runs itself.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { relayIfEnabled } from './session-relay.ts';
import { PERMISSION_HOOK_TIMEOUT_S, STOP_HOOK_TIMEOUT_S, permissionOutput, withBridgeHooks, withoutBridgeHooks, type WaitAnswer } from '../src/apps/claude/server/pclink.ts';

const SCRIPT = fileURLToPath(import.meta.url);
const LINK_FILE = path.join(path.dirname(SCRIPT), '..', '.pc-bridge.json');
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function link(): { url: string; key: string } | null {
  try {
    const o = JSON.parse(fs.readFileSync(LINK_FILE, 'utf8'));
    return typeof o?.url === 'string' && typeof o?.key === 'string' ? o : null;
  } catch { return null; }
}

async function stdinJson(): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

async function post(route: string, body: Record<string, unknown>, ms: number): Promise<any | null> {
  const l = link();
  if (!l) return null;
  try {
    const r = await fetch(`${l.url}/api/claude/${route}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: l.key, ...body }), signal: AbortSignal.timeout(ms),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** Background Stop hook: wait for a reply from the tablet; print it and exit 2 to wake this session with it. */
async function stopHook(): Promise<number> {
  const input = await stdinJson();
  const session = typeof input.session_id === 'string' ? input.session_id : '';
  if (!session) return 0;
  await relayIfEnabled(input);   // prototype; does nothing unless host/logs/session-relay.enabled exists
  const waiter = crypto.randomUUID(), until = Date.now() + (STOP_HOOK_TIMEOUT_S - 60) * 1000;
  let fresh = true, downSince = 0;
  while (Date.now() < until) {
    const r = await post('pc/wait', { session, waiter, fresh, ...(fresh && typeof input.last_assistant_message === 'string' ? { lastText: input.last_assistant_message.slice(0, 4000) } : {}) }, 40e3);
    if (!r?.ok) {
      // hub down or restarting: keep trying for an hour, then give up quietly
      downSince ||= Date.now();
      if (Date.now() - downSince > 3600e3) return 0;
      await sleep(10e3);
      continue;
    }
    downSince = 0; fresh = false;
    const a = r.answer as WaitAnswer;
    if (a?.kind === 'reply' && typeof a.text === 'string') {
      await new Promise<void>(done => process.stderr.write(a.text, () => done()));
      return 2;
    }
    if (a?.kind === 'stop') return 0;
  }
  return 0;
}

/** PermissionRequest hook: while the tablet drives this session, the tablet answers. No answer: print nothing. */
async function permissionHook(): Promise<number> {
  const input = await stdinJson();
  const session = typeof input.session_id === 'string' ? input.session_id : '';
  if (!session || typeof input.tool_name !== 'string') return 0;
  const r = await post('pc/permission', { session, tool: input.tool_name, input: input.tool_input ?? {} }, (PERMISSION_HOOK_TIMEOUT_S - 10) * 1000);
  const out = permissionOutput(r?.ok ? r.decision : null);
  if (out) await new Promise<void>(done => process.stdout.write(out, () => done()));
  return 0;
}

function readSettings(): Record<string, any> {
  if (!fs.existsSync(SETTINGS)) return {};
  const o = JSON.parse(fs.readFileSync(SETTINGS, 'utf8').replace(/^﻿/, ''));   // a broken file stops here, unchanged
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(`${SETTINGS} is not a JSON object`);
  return o;
}

function writeSettings(next: Record<string, any>): void {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, `${SETTINGS}.claude-os-pc-hook-backup`);
  fs.writeFileSync(SETTINGS, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

async function main(): Promise<number> {
  const cmd = process.argv[2];
  if (cmd === 'stop' || cmd === 'permission') {
    if (process.env.CLAUDEOS_HUB_TURN === '1') return 0;   // the hub runs this turn and answers it itself
    return cmd === 'stop' ? stopHook() : permissionHook();
  }
  if (cmd === 'install') {
    // forward slashes work in both shells Claude Code may run hooks with (cmd and Git Bash)
    const q = (p: string) => `"${p.replace(/\\/g, '/')}"`;
    const command = `${q(process.execPath)} --disable-warning=ExperimentalWarning ${q(SCRIPT)}`;
    writeSettings(withBridgeHooks(readSettings(), command));
    console.log(`PC link hooks added to ${SETTINGS} (backup: settings.json.claude-os-pc-hook-backup).`);
    console.log('Reopen any Claude Code session that is already open so it loads them.');
    return 0;
  }
  if (cmd === 'uninstall') {
    writeSettings(withoutBridgeHooks(readSettings()));
    console.log(`PC link hooks removed from ${SETTINGS}.`);
    return 0;
  }
  console.log('usage: node scripts/claude-os-pc-hook.ts install | uninstall');
  return 1;
}

main().then(code => process.exit(code), e => { console.error(String((e as Error)?.message || e)); process.exit(1); });
