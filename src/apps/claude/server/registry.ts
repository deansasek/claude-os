// Which Claude Code sessions are open right now. Every running Claude Code process
// (terminal or desktop app) writes ~/.claude/sessions/<pid>.json with its session id;
// an entry counts only while that process is still alive.
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from '../../../core/server/paths.ts';

const DIR = path.join(HOME, '.claude', 'sessions');

export interface OpenSession { pid: number; entrypoint: string | null; status: string | null }

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

export function openSessions(): Map<string, OpenSession> {
  const out = new Map<string, OpenSession>();
  let files: string[] = [];
  try { files = fs.readdirSync(DIR).filter(f => /^\d+\.json$/.test(f)); } catch { return out; }
  for (const f of files) {
    try {
      const o = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      if (o.sessionId && typeof o.pid === 'number' && alive(o.pid)) {
        out.set(o.sessionId, { pid: o.pid, entrypoint: o.entrypoint ?? null, status: o.status ?? null });
      }
    } catch { /* a file being rewritten; skip it this time */ }
  }
  return out;
}
