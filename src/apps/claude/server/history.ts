// Every Claude Code session on this PC, for the Sessions screen's sidebar (like the desktop app's list).
//
// One entry per log in ~/.claude/projects/<folder>/<id>.jsonl: title, project folder, last activity,
// message count. Logs can be hundreds of MB, mostly a few huge lines, so each log is read once, in
// chunks, looking only at the ends of big lines; after that only the bytes appended since are read
// (by size and mtime). The index lives in memory; nothing from it is logged.
import fs from 'node:fs';
import path from 'node:path';
import type { History, HistoryGroup, HistoryItem } from '../api.ts';
import { PROJECTS } from '../../../core/server/paths.ts';
import { cwdOf, folderOf, hostSession, hostSessionIds } from './hostsessions.ts';
import { openSessions } from './registry.ts';
import { userText } from './sessions.ts';
import { archivedIds } from './state.ts';

const LIVE_WINDOW_MS = 30 * 60e3;
const CHUNK = 4 * 1024 * 1024;
const SMALL = 32 * 1024;          // lines shorter than this are parsed; longer ones are only peeked at
const PEEK = 1500;
const REFRESH_MS = 4000;          // at most one sweep of the folders this often

interface Entry {
  id: string; file: string; dir: string;
  size: number; mtime: number; scanned: number;   // bytes read so far (always at a line boundary)
  cwd: string | null; folderId: string; folder: string;
  custom: string | null; summary: string | null; agent: string | null; first: string | null;
  lastAt: number; messages: number;
  search: string;
}

const index = new Map<string, Entry>();   // by file path
let sweeping: Promise<void> | null = null;
let sweptAt = 0;
export const historyStats = { files: 0, lastSweepMs: 0, bytesRead: 0 };

const TS = /"timestamp":"([^"]{10,40})"/g;
function lastTimestamp(s: string): number {
  let at = 0;
  for (const m of s.matchAll(TS)) { const t = Date.parse(m[1]); if (!Number.isNaN(t)) at = t; }
  return at;
}

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

/** Look at one complete line of a log. */
function take(e: Entry, line: Buffer): void {
  if (line.length < 20) return;
  if (line.length <= SMALL) {
    let o: any;
    try { o = JSON.parse(line.toString('utf8')); } catch { return; }
    const t = o.type;
    if (t === 'custom-title' && o.customTitle) e.custom = String(o.customTitle);
    else if (t === 'summary' && o.summary) e.summary = String(o.summary);
    else if (t === 'ai-title' && (o.aiTitle || o.title)) e.summary = String(o.aiTitle || o.title);
    else if (t === 'agent-name' && o.agentName) e.agent = String(o.agentName);
    if (o.isSidechain || o.isMeta) return;
    if (t === 'user') {
      const c = o.message?.content;
      if (Array.isArray(c) && c.some((x: any) => x?.type === 'tool_result') && !c.some((x: any) => x?.type === 'text')) return;
      const text = userText(c);
      if (!text) return;
      e.messages++;
      if (!e.first && !text.startsWith('[Request interrupted')) e.first = clip(text, 120);
    } else if (t === 'assistant') {
      if (Array.isArray(o.message?.content) && o.message.content.some((x: any) => x?.type === 'text' && x.text?.trim())) e.messages++;
    } else if (t !== 'system') return;
    const at = Date.parse(o.timestamp);
    if (!Number.isNaN(at) && at > e.lastAt) e.lastAt = at;
    return;
  }
  // a big line: peek at both ends (the type and timestamp sit outside the message body)
  const head = line.subarray(0, PEEK).toString('utf8'), tail = line.subarray(line.length - PEEK).toString('utf8');
  if (head.includes('"isSidechain":true') || /"isMeta":true/.test(head + tail)) return;
  if (head.includes('"type":"user"') && head.includes('"role":"user"')) {
    const body = head.slice(head.indexOf('"content":'), head.indexOf('"content":') + 200);
    if (body.includes('tool_result') || body.includes('"tool_use_id"')) return;
    e.messages++;
    if (!e.first) {   // a huge first message (pasted text): parse just this once
      try { const t = userText(JSON.parse(line.toString('utf8')).message?.content); if (t) e.first = clip(t, 120); } catch { /* odd line */ }
    }
  } else if ((tail.includes('"type":"assistant"') || head.includes('"type":"assistant"')) && head.includes('"role":"assistant"')) {
    if (head.includes('"content":[{"type":"text"')) e.messages++;
  } else return;
  const at = lastTimestamp(tail);
  if (at > e.lastAt) e.lastAt = at;
}

async function scan(e: Entry, size: number): Promise<void> {
  if (size < e.scanned) {   // rewritten: start again
    Object.assign(e, { scanned: 0, custom: null, summary: null, agent: null, first: null, lastAt: 0, messages: 0 });
  }
  const fh = await fs.promises.open(e.file, 'r');
  try {
    let pos = e.scanned, carry: Buffer | null = null;
    const buf = Buffer.alloc(CHUNK);
    while (pos < size) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, size - pos), pos);
      if (!bytesRead) break;
      pos += bytesRead;
      historyStats.bytesRead += bytesRead;
      let data = buf.subarray(0, bytesRead);
      if (carry) { data = Buffer.concat([carry, data]); carry = null; }
      let start = 0, nl: number;
      while ((nl = data.indexOf(10, start)) !== -1) {
        take(e, data.subarray(start, nl));
        start = nl + 1;
      }
      if (start < data.length) carry = Buffer.from(data.subarray(start));   // a line still being written, or one longer than a chunk
      e.scanned = pos - (carry ? carry.length : 0);
    }
  } finally { await fh.close(); }
}

/** Bring the index up to date: new logs are read whole once, grown ones only from where we stopped. */
async function sweep(): Promise<void> {
  const t0 = Date.now();
  const seen = new Set<string>();
  let dirs: string[] = [];
  try { dirs = await fs.promises.readdir(PROJECTS); } catch { /* no logs yet */ }
  for (const dir of dirs) {
    let files: string[] = [];
    try { files = (await fs.promises.readdir(path.join(PROJECTS, dir))).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const file = path.join(PROJECTS, dir, f);
      seen.add(file);
      let st: fs.Stats;
      try { st = await fs.promises.stat(file); } catch { continue; }
      let e = index.get(file);
      if (e && e.size === st.size && e.mtime === st.mtimeMs) continue;
      if (!e) {
        let cwd: string | null = null;
        try { cwd = cwdOf(file, dir); } catch { /* unreadable */ }
        const fo = folderOf(cwd);
        e = { id: f.slice(0, -6), file, dir, size: 0, mtime: 0, scanned: 0, cwd, folderId: fo.id, folder: fo.name,
          custom: null, summary: null, agent: null, first: null, lastAt: 0, messages: 0, search: '' };
        index.set(file, e);
      }
      try { await scan(e, st.size); } catch { continue; }
      e.size = st.size; e.mtime = st.mtimeMs;
      if (!e.lastAt) e.lastAt = st.mtimeMs;
      e.search = [e.custom, e.summary, e.agent, e.first, e.folder].filter(Boolean).join(' \n ').toLowerCase();
    }
  }
  for (const k of index.keys()) if (!seen.has(k)) index.delete(k);
  historyStats.files = index.size;
  historyStats.lastSweepMs = Date.now() - t0;
  sweptAt = Date.now();
}

export function refreshHistory(): Promise<void> {
  if (sweeping) return sweeping;
  if (Date.now() - sweptAt < REFRESH_MS) return Promise.resolve();
  sweeping = sweep().finally(() => { sweeping = null; });
  return sweeping;
}

const titleOf = (e: Entry) => e.custom || e.summary || e.agent || hostSession(e.id)?.title || e.first || 'Untitled session';

/** Drop a deleted log from the index at once (the next sweep would too). */
export function forgetHistory(file: string): void { index.delete(file); }

export interface HistoryQuery { q?: string; folder?: string; before?: string; limit?: number; archived?: boolean }

/**
 * Sessions grouped by folder, folders ordered by their newest session. Without `folder`, each
 * group carries its newest few; with `folder` (and `before`, an ISO time), the next page of that one.
 */
export async function history(o: HistoryQuery): Promise<History> {
  await refreshHistory();
  const q = (o.q || '').trim().toLowerCase().slice(0, 80);
  const words = q.split(/\s+/).filter(Boolean);
  const before = o.before ? Date.parse(o.before) : NaN;
  const limit = Math.max(1, Math.min(o.limit || (o.folder ? 25 : 6), 100));
  const now = Date.now();
  const open = openSessions(), hostIds = hostSessionIds();

  const byFolder = new Map<string, Entry[]>();
  const archived = archivedIds();
  let total = 0, archivedCount = 0;
  for (const e of index.values()) {
    if (!e.messages && !e.custom && !hostIds.has(e.id)) continue;   // empty logs (opened and closed)
    const isArchived = archived.has(e.id);
    if (isArchived) archivedCount++;
    if (isArchived !== !!o.archived) continue;   // the main list, or the Archived view
    if (words.length && !words.every(w => e.search.includes(w))) continue;
    if (o.folder && e.folderId !== o.folder) continue;
    total++;
    const g = byFolder.get(e.folderId) || [];
    g.push(e); byFolder.set(e.folderId, g);
  }
  const groups: HistoryGroup[] = [];
  for (const [id, list] of byFolder) {
    list.sort((a, b) => b.lastAt - a.lastAt);
    const page = (Number.isNaN(before) ? list : list.filter(e => e.lastAt < before));
    const items: HistoryItem[] = page.slice(0, limit).map(e => ({
      id: e.id, title: titleOf(e), at: new Date(e.lastAt).toISOString(), messages: e.messages,
      open: open.has(e.id), live: now - e.mtime < LIVE_WINDOW_MS, hub: hostIds.has(e.id),
    }));
    groups.push({ id, name: list[0].folder, count: list.length, latest: new Date(list[0].lastAt).toISOString(), items, more: page.length > limit });
  }
  groups.sort((a, b) => b.latest.localeCompare(a.latest));
  return { q, total, groups, archived: archivedCount };
}
