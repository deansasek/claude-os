// Prototype: post one message into this Claude Code session through its cross-session messaging socket
// (code.claude.com/docs/en/cross-session-messaging, "The session's inbox socket").
//
// Runs only while host/logs/session-relay.enabled exists, and sends at most once per flag file: after a send it
// writes "sent" into the flag, so the turn the message starts cannot send again. The test creates and removes the flag.
//
//   node scripts/session-relay.ts [text]   send now (reads optional Stop hook JSON on stdin for the log)
//
// Never logs the token.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = path.join(ROOT, 'host', 'logs');
export const RELAY_FLAG = path.join(LOG_DIR, 'session-relay.enabled');
const RELAY_LOG = path.join(LOG_DIR, 'session-relay.log');
export const RELAY_TEST_TEXT = 'Relay test from ClaudeOS. Reply with the word received.';

function log(line: string): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(RELAY_LOG, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch { /* logging must never break the hook */ }
}

/** The message line. Shape taken from the CLI's own --messaging-socket-path help recipe. */
export function messageLine(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';
}

/** Connect, send the auth line and one message line, then collect any reply until the pipe closes or 3 s pass. */
export function send(socket: string, token: string, text: string): Promise<{ ok: boolean; reply: string; error?: string }> {
  return new Promise(resolve => {
    let reply = '', done = false;
    const finish = (ok: boolean, error?: string) => {
      if (done) return;
      done = true; clearTimeout(timer); c.destroy();
      resolve({ ok, reply: reply.slice(0, 2000), ...(error ? { error } : {}) });
    };
    const c = net.connect(socket, () => {
      c.write(JSON.stringify({ type: 'auth', token }) + '\n' + messageLine(text), () => c.end());
    });
    c.on('data', d => { reply += d.toString('utf8'); });
    c.on('end', () => finish(true));
    c.on('close', () => finish(true));
    c.on('error', e => finish(false, `${(e as NodeJS.ErrnoException).code ?? ''} ${e.message}`.trim()));
    const timer = setTimeout(() => finish(true, 'no close within 3 s'), 3000);
  });
}

/** Called by the Stop hook: send RELAY_TEST_TEXT once while the flag file exists. */
export async function relayIfEnabled(input: { session_id?: unknown; transcript_path?: unknown }, text = RELAY_TEST_TEXT): Promise<void> {
  let flag: string;
  try { flag = fs.readFileSync(RELAY_FLAG, 'utf8'); } catch { return; }
  if (flag.includes('sent')) return;
  fs.writeFileSync(RELAY_FLAG, `sent ${new Date().toISOString()}\n`, 'utf8');
  const socket = process.env.CLAUDE_CODE_MESSAGING_SOCKET ?? '', token = process.env.CLAUDE_CODE_MESSAGING_TOKEN ?? '';
  log(`start session=${String(input.session_id ?? '')} transcript=${String(input.transcript_path ?? '')} socket=${socket || '(unset)'} token=${token ? 'set' : '(unset)'}`);
  if (!socket || !token) { log('skip: messaging variables missing'); return; }
  const r = await send(socket, token, text);
  log(`result ok=${r.ok} error=${r.error ?? '-'} reply=${JSON.stringify(r.reply)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let input: Record<string, unknown> = {};
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^﻿/, '')); } catch { /* no hook input */ }
  }
  await relayIfEnabled(input, process.argv[2] || RELAY_TEST_TEXT);
}
