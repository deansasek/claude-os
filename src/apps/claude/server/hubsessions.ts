// Sessions started from the Hub, and the folders you can start one in.
//
// Sessions the Hub starts are remembered in hub-sessions.json, so they stay listed and
// answerable from the Hub however long they've been quiet (they're never open on the PC).
// The folder list comes from the working folders of your recent Claude Code sessions, plus a
// scratch folder inside the hub. Full paths stay on this PC; the Hub only sees names and ids.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Project } from '../api.ts';
import { HOME, HUB, PROJECTS, readJson } from '../../../core/server/paths.ts';

const FILE = path.join(HUB, 'hub-sessions.json');
export const SCRATCH = path.join(HUB, 'workspace');
const RECENT_MS = 60 * 864e5;

export interface HubSessionRecord { id: string; cwd: string; title: string; createdAt: string }

let records: HubSessionRecord[] = readJson<{ sessions: HubSessionRecord[] }>(FILE)?.sessions || [];

export const hubSessionIds = (): Set<string> => new Set(records.map(r => r.id));
export const hubSession = (id: string): HubSessionRecord | undefined => records.find(r => r.id === id);

export function rememberHubSession(r: HubSessionRecord): void {
  records = [r, ...records.filter(x => x.id !== r.id)].slice(0, 50);
  fs.writeFileSync(FILE, JSON.stringify({ sessions: records }, null, 2));
}

/** Forget a session the Hub started (after it is deleted). */
export function forgetHubSession(id: string): void {
  if (!records.some(r => r.id === id)) return;
  records = records.filter(r => r.id !== id);
  fs.writeFileSync(FILE, JSON.stringify({ sessions: records }, null, 2));
}

// ---------- folders to start in ----------
export const idFor = (cwd: string) => crypto.createHash('sha1').update(cwd.toLowerCase()).digest('hex').slice(0, 12);
let cache: { at: number; list: (Project & { cwd: string })[] } | null = null;

/** The folder a session is listed under: its name and id (the same id a new session starts in). */
export function folderOf(cwd: string | null): { id: string; name: string } {
  const c = (cwd || '').replace(/[\\/]+$/, '');
  if (c && c.toLowerCase() === SCRATCH.toLowerCase()) return { id: idFor(SCRATCH), name: 'Scratch space' };
  if (!c || c.includes('scratch-workspaces')) return { id: 'none', name: 'No folder' };
  return { id: idFor(c), name: path.basename(c) || c };
}

/**
 * The project folder a session log belongs to. The folder it started in is recorded near the top
 * (after possibly huge snapshot lines), and it may wander into subfolders later, so read both ends
 * and take the shortest folder seen.
 */
export function cwdOf(file: string, dirName: string): string | null {
  const CWD = /"(?:cwd|relocatedCwd)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  const size = fs.statSync(file).size, CHUNK = 1024 * 1024;
  const found: string[] = [];
  const scan = (s: string) => { for (const m of s.matchAll(CWD)) { try { found.push(JSON.parse(`"${m[1]}"`)); } catch { /* odd escape */ } } };
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(CHUNK);
    for (let pos = 0; pos < Math.min(size, 8 * CHUNK) && !found.length; pos += CHUNK - 4096) {   // overlap so a match can't straddle chunks
      const n = fs.readSync(fd, buf, 0, CHUNK, pos);
      scan(buf.subarray(0, n).toString('utf8'));
    }
    const tail = Math.min(size, 256 * 1024), tb = Buffer.alloc(tail);
    fs.readSync(fd, tb, 0, tail, size - tail);
    scan(tb.toString('utf8'));
  } finally { fs.closeSync(fd); }
  // Claude Code names the log folder after the project path, every non-alphanumeric turned into '-':
  // the project is whichever recorded folder (or a parent of one) encodes to that name
  const encode = (p: string) => p.replace(/[^a-zA-Z0-9]/g, '-');
  for (const f of new Set(found)) {
    for (let p = f; p && p !== path.dirname(p); p = path.dirname(p)) if (encode(p) === dirName) return p;
  }
  return found.length ? found.reduce((a, b) => (b.length < a.length ? b : a)) : null;
}

function allProjects(): (Project & { cwd: string })[] {
  if (cache && Date.now() - cache.at < 60e3) return cache.list;
  const seen = new Map<string, Project & { cwd: string }>();
  const add = (cwd: string, at: number, note?: string) => {
    const key = cwd.toLowerCase();
    const prev = seen.get(key);
    if (prev && Date.parse(prev.lastUsed) >= at) return;
    const name = path.basename(cwd) || cwd;
    const detail = note || (cwd.startsWith(HOME) ? '~' + cwd.slice(HOME.length) : cwd).replace(/\\/g, '/');
    seen.set(key, { id: idFor(cwd), name, detail, lastUsed: new Date(at).toISOString(), cwd });
  };
  let dirs: string[] = [];
  try { dirs = fs.readdirSync(PROJECTS); } catch { /* none */ }
  for (const d of dirs) {
    let newest: { file: string; at: number } | null = null;
    try {
      for (const f of fs.readdirSync(path.join(PROJECTS, d))) {
        if (!f.endsWith('.jsonl')) continue;
        const at = fs.statSync(path.join(PROJECTS, d, f)).mtimeMs;
        if (!newest || at > newest.at) newest = { file: path.join(PROJECTS, d, f), at };
      }
    } catch { continue; }
    if (!newest || Date.now() - newest.at > RECENT_MS) continue;
    let cwd: string | null = null;
    try { cwd = cwdOf(newest.file, d); } catch { /* unreadable */ }
    // skip throwaway places: app scratch workspaces and temp folders
    if (!cwd || /scratch-workspaces|[\\/]Temp[\\/]|[\\/]tmp[\\/]/i.test(cwd) || !fs.existsSync(cwd)) continue;
    add(cwd, newest.at);
  }
  for (const r of records) if (r.cwd !== SCRATCH && fs.existsSync(r.cwd)) add(r.cwd, Date.parse(r.createdAt));
  const list = [...seen.values()].sort((a, b) => b.lastUsed.localeCompare(a.lastUsed)).slice(0, 12);
  list.push({ id: idFor(SCRATCH), name: 'Scratch space', detail: 'A blank folder for quick questions and one-offs', lastUsed: '', cwd: SCRATCH });
  cache = { at: Date.now(), list };
  return list;
}

export const listProjects = (): Project[] => allProjects().map(({ cwd: _cwd, ...p }) => p);

export function projectFolder(id: string): string | null {
  const p = allProjects().find(x => x.id === id);
  if (!p) return null;
  if (p.cwd === SCRATCH) fs.mkdirSync(SCRATCH, { recursive: true });
  return p.cwd;
}
