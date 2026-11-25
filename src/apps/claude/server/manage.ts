// Archive and delete sessions from Claude Home, like the desktop app.
// Archiving only hides a session (state.ts); nothing on disk changes. Deleting removes the session's own log
// (~/.claude/projects/<folder>/<id>.jsonl), its own folder beside the log (subagents, tool results), and its
// file-history and session-env folders, and nothing else. Every path is built from the id and checked before
// anything is removed. A session with a reply running, or open in a Claude Code window, is refused.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, PROJECTS } from '../../../core/server/paths.ts';
import { forkSession } from '@anthropic-ai/claude-agent-sdk';
import { forgetHistory } from './history.ts';
import { logAction } from './guard.ts';
import { forgetHubSession, rememberHostSession } from './hostsessions.ts';
import { forgetState, setArchived, setPinned } from './state.ts';
import { forgetTranscript, lookupSession } from './sessions.ts';
import { hostTurnRunning } from './turns.ts';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A message id from the log, optionally with "#n" for a later block of the same message. */
const MESSAGE_ID = /^[\w-]{8,64}(#\d{1,3})?$/;
export type ManageResult = { ok: true } | { ok: false; error: string };

/** Pin or unpin a message of a session (kept in claude-state.json). */
export function pinMessage(sessionId: string, messageId: string, on: boolean, from: string): ManageResult {
  if (!SESSION_ID.test(sessionId)) return { ok: false, error: 'bad_id' };
  if (!MESSAGE_ID.test(messageId)) return { ok: false, error: 'bad_message' };
  if (!lookupSession(sessionId)) return { ok: false, error: 'not_found' };
  setPinned(sessionId, messageId, on);
  logAction(from, on ? 'pin' : 'unpin', { session: sessionId });
  return { ok: true };
}

/**
 * A new session that continues from one of Claude's replies: the SDK copies the log up to that message
 * (its own message ids, no file history) and the copy is remembered as a Hub session, so it can be replied to here.
 * Only replies are offered: a copy ending on your own message would have nothing to answer it.
 */
export async function forkFrom(sessionId: string, messageId: string, from: string): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
  if (!SESSION_ID.test(sessionId)) return { ok: false, error: 'bad_id' };
  if (!MESSAGE_ID.test(messageId)) return { ok: false, error: 'bad_message' };
  const s = lookupSession(sessionId);
  if (!s || !s.cwd) return { ok: false, error: 'not_found' };
  try {
    const title = `${s.live.title} (fork)`.slice(0, 120);
    const r = await forkSession(sessionId, { dir: s.cwd, upToMessageId: messageId.split('#')[0], title });
    rememberHostSession({ id: r.sessionId, cwd: s.cwd, title, createdAt: new Date().toISOString() });
    logAction(from, 'fork', { session: sessionId, forked: r.sessionId });
    return { ok: true, sessionId: r.sessionId };
  } catch (e) {
    console.log('claude: fork failed:', String((e as Error).message || e).slice(0, 160));
    return { ok: false, error: 'fork_failed' };
  }
}

export function archiveSession(id: string, on: boolean, from: string): ManageResult {
  if (!SESSION_ID.test(id)) return { ok: false, error: 'bad_id' };
  if (!lookupSession(id)) return { ok: false, error: 'not_found' };
  setArchived(id, on);
  logAction(from, on ? 'archive' : 'unarchive', { session: id });
  return { ok: true };
}

const isDir = (p: string): boolean => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };

/** The log really is this session's: its first or last lines name the session id. */
function logIsFor(file: string, id: string): boolean {
  const size = fs.statSync(file).size, n = Math.min(size, 128 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(n), tail = Buffer.alloc(n);
    fs.readSync(fd, head, 0, n, 0);
    fs.readSync(fd, tail, 0, n, size - n);
    const needle = `"sessionId":"${id}"`;
    return head.toString('utf8').includes(needle) || tail.toString('utf8').includes(needle);
  } finally { fs.closeSync(fd); }
}

export function deleteSession(id: string, from: string): ManageResult {
  if (!SESSION_ID.test(id)) return { ok: false, error: 'bad_id' };
  const s = lookupSession(id);
  if (!s) return { ok: false, error: 'not_found' };
  if (hostTurnRunning(id) || s.live.state === 'thinking' || s.live.state === 'tool') return { ok: false, error: 'running' };
  if (s.live.open) return { ok: false, error: 'open_on_pc' };

  // the log must sit directly in a folder directly under the projects folder, and be named for this session
  const root = path.resolve(PROJECTS), file = path.resolve(s.file), dir = path.dirname(file);
  if (path.basename(file) !== `${id}.jsonl` || path.dirname(dir) !== root || !isDir(dir)) return { ok: false, error: 'not_found' };
  let real = false;
  try { real = fs.lstatSync(file).isFile() && logIsFor(file, id); } catch { real = false; }
  if (!real) return { ok: false, error: 'not_this_session' };

  // a log the PC still holds open (EBUSY, EPERM) cannot go: nothing else is removed
  try { fs.unlinkSync(file); }
  catch (e) {
    console.log('claude: delete failed:', String((e as Error).message || e).slice(0, 160));
    return { ok: false, error: 'delete_failed' };
  }
  // the folders kept for this session: each is removed only if it is a real folder named for the id
  for (const folder of [path.join(dir, id), path.join(HOME, '.claude', 'file-history', id), path.join(HOME, '.claude', 'session-env', id)]) {
    if (path.basename(folder) === id && isDir(folder)) fs.rmSync(folder, { recursive: true, force: true });
  }
  forgetTranscript(id);
  forgetHistory(file);
  forgetHubSession(id);
  forgetState(id);
  logAction(from, 'delete', { session: id });
  return { ok: true };
}
