// The session relay: post a tablet reply into a Claude Code session as a real user message, through the session's
// cross-session messaging socket (code.claude.com/docs/en/cross-session-messaging, "The session's inbox socket").
//
// The Stop hook (scripts/claude-os-pc-hook.ts) calls relayReply() when the tablet sends a reply. If the relay fails for
// any reason, the hook falls back to the Stop-hook note (stderr + exit 2), so no reply is lost.
// host/logs/session-relay.off turns the relay off (the note is used instead).
//
//   node scripts/session-relay.ts [text]   send a test message now, once per host/logs/session-relay.enabled flag file
//
// Never logs the messaging token.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tabletReplyIn } from '../src/apps/claude/server/pclink.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = path.join(ROOT, 'host', 'logs');
export const RELAY_FLAG = path.join(LOG_DIR, 'session-relay.enabled');
export const RELAY_OFF = path.join(LOG_DIR, 'session-relay.off');
const RELAY_LOG = path.join(LOG_DIR, 'session-relay.log');
export const RELAY_TEST_TEXT = 'Relay test from ClaudeOS. Reply with the word received.';

export type RelayResult = { ok: boolean; reply: string; error?: string };

function log(line: string): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(RELAY_LOG, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch { /* logging must never break the hook */ }
}

/** The message line: one user turn. */
export function messageLine(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';
}

/** What the relay posts for a reply from the hub: the tablet's own words, without the Stop-hook note wrapper. */
export function relayText(hookText: string): string {
  const inner = tabletReplyIn(hookText);
  return inner ? inner : hookText;
}

/** Did the socket take the message? Only when both lines were written and the socket did not answer with an error. */
export function relayDelivered(r: RelayResult | null | undefined): boolean {
  return !!r && r.ok && !/"type"\s*:\s*"error"/.test(r.reply);
}

/** Connect, send the auth line and one message line, then collect any reply until the pipe closes or 3 s pass.
 *  ok: both lines were written. Never rejects. */
export function send(socket: string, token: string, text: string): Promise<RelayResult> {
  return new Promise(resolve => {
    let reply = '', done = false, written = false;
    let c: net.Socket | null = null;
    const finish = (error?: string) => {
      if (done) return;
      done = true; clearTimeout(timer); c?.destroy();
      resolve({ ok: written, reply: reply.slice(0, 2000), ...(error ? { error } : {}) });
    };
    const timer = setTimeout(() => finish('no close within 3 s'), 3000);
    try {
      c = net.connect(socket, () => {
        c!.write(JSON.stringify({ type: 'auth', token }) + '\n' + messageLine(text), e => { if (!e) written = true; c!.end(); });
      });
      c.on('data', d => { reply += d.toString('utf8'); });
      c.on('close', () => finish());
      c.on('error', e => finish(`${(e as NodeJS.ErrnoException).code ?? ''} ${e.message}`.trim()));
    } catch (e) { finish(String((e as Error)?.message || e)); }
  });
}

/** Post a tablet reply (the hub's hook-note text) into this session. True only when the socket took it. Never throws. */
export async function relayReply(hookText: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  try {
    if (fs.existsSync(RELAY_OFF)) { log('skip: relay turned off'); return false; }
    const socket = env.CLAUDE_CODE_MESSAGING_SOCKET ?? '', token = env.CLAUDE_CODE_MESSAGING_TOKEN ?? '';
    if (!socket || !token) { log('skip: messaging variables missing'); return false; }
    const r = await send(socket, token, relayText(hookText));
    const ok = relayDelivered(r);
    log(`reply ok=${ok} written=${r.ok} error=${r.error ?? '-'} reply=${JSON.stringify(r.reply)}`);
    return ok;
  } catch (e) {
    log(`reply failed: ${String((e as Error)?.message || e)}`);
    return false;
  }
}

/** Test only: send RELAY_TEST_TEXT once while the flag file exists. Never throws. */
export async function relayIfEnabled(input: { session_id?: unknown }, text = RELAY_TEST_TEXT): Promise<void> {
  try {
    let flag: string;
    try { flag = fs.readFileSync(RELAY_FLAG, 'utf8'); } catch { return; }
    if (flag.includes('sent')) return;
    fs.writeFileSync(RELAY_FLAG, `sent ${new Date().toISOString()}\n`, 'utf8');
    const socket = process.env.CLAUDE_CODE_MESSAGING_SOCKET ?? '', token = process.env.CLAUDE_CODE_MESSAGING_TOKEN ?? '';
    log(`test session=${String(input.session_id ?? '')} socket=${socket ? 'set' : '(unset)'} token=${token ? 'set' : '(unset)'}`);
    if (!socket || !token) return;
    const r = await send(socket, token, text);
    log(`test ok=${r.ok} error=${r.error ?? '-'} reply=${JSON.stringify(r.reply)}`);
  } catch { /* the hook must still exit normally */ }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await relayIfEnabled({}, process.argv[2] || RELAY_TEST_TEXT);
}
