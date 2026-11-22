// Tails ~/.claude/projects/**/*.jsonl incrementally and aggregates token usage.
import fs from 'node:fs';
import path from 'node:path';
import type { Today, Usage } from '../api.ts';
import { PROJECTS, listJsonl } from '../../../core/server/paths.ts';

const KEEP_DAYS = 8;
const BLOCK_MS = 5 * 3600e3;
const CHUNK = 8 * 1024 * 1024;

interface Entry {
  ts: number; model: string;
  inp: number; out: number; cr: number; cw: number;
  session: string; project: string;
}
const total = (e: Entry) => e.inp + e.out + e.cr + e.cw;

/** Read [start, end) of a file line by line; returns the offset after the last complete line. */
function readLines(file: string, start: number, end: number, onLine: (line: Buffer) => void): number {
  const fd = fs.openSync(file, 'r');
  let pos = start, carry = Buffer.alloc(0);
  try {
    while (pos < end) {
      const len = Math.min(CHUNK, end - pos);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, pos);
      pos += len;
      const data = carry.length ? Buffer.concat([carry, buf]) : buf;
      let s = 0, i: number;
      while ((i = data.indexOf(10, s)) !== -1) { onLine(data.subarray(s, i)); s = i + 1; }
      carry = data.subarray(s);
    }
  } finally {
    fs.closeSync(fd);
  }
  return end - carry.length;
}

export class Store {
  private offsets = new Map<string, number>();
  private seen = new Set<string>();
  entries: Entry[] = [];

  scan(): number {
    const cutoff = Date.now() - KEEP_DAYS * 864e5;
    const fresh: Entry[] = [];
    for (const file of listJsonl(PROJECTS)) {
      let st: fs.Stats;
      try { st = fs.statSync(file); } catch { continue; }
      if (!this.offsets.has(file) && st.mtimeMs < cutoff) { this.offsets.set(file, st.size); continue; }  // old: only watch for growth
      let off = this.offsets.get(file) ?? 0;
      if (st.size < off) off = 0;                       // truncated or replaced
      if (st.size === off) continue;
      try {
        const next = readLines(file, off, st.size, line => {
          if (line.indexOf('"usage"') < 0 || line.indexOf('"assistant"') < 0) return;
          const e = this.parse(line);
          if (e) fresh.push(e);
        });
        this.offsets.set(file, next);
      } catch { /* file vanished mid-read; try again next scan */ }
    }
    if (fresh.length) {
      const keepAfter = Date.now() - KEEP_DAYS * 864e5;
      this.entries = this.entries.concat(fresh).filter(e => e.ts >= keepAfter).sort((a, b) => a.ts - b.ts);
    }
    return fresh.length;
  }

  private parse(line: Buffer): Entry | null {
    let o: any;
    try { o = JSON.parse(line.toString('utf8')); } catch { return null; }
    if (o.type !== 'assistant') return null;
    const msg = o.message || {}, u = msg.usage, model: string = msg.model || '?';
    if (!u || model === '<synthetic>') return null;
    const key = `${msg.id}:${o.requestId}`;
    if (this.seen.has(key)) return null;
    this.seen.add(key);
    const ts = Date.parse(o.timestamp);
    if (Number.isNaN(ts)) return null;
    return {
      ts, model,
      inp: u.input_tokens || 0, out: u.output_tokens || 0,
      cr: u.cache_read_input_tokens || 0, cw: u.cache_creation_input_tokens || 0,
      session: o.sessionId || '?',
      project: path.basename(String(o.cwd || '').replace(/[\\/]+$/, '')) || '?',
    };
  }

  /** Everything /api/usage reports except limits, sessions, plan and page version. */
  summary(): Omit<Usage, 'limits' | 'sessions' | 'plan' | 'turns'> & { tokensBySession: Map<string, number> } {
    const entries = this.entries, now = Date.now();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const t0 = todayStart.getTime();

    const today: Today = { input: 0, output: 0, cache_read: 0, cache_write: 0, messages: 0, total: 0 };
    const byModel = new Map<string, number>(), byProject = new Map<string, number>(), bySession = new Map<string, number>();
    const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) || 0) + v);
    for (const e of entries) {
      if (e.ts < t0) continue;
      today.input += e.inp; today.output += e.out; today.cache_read += e.cr; today.cache_write += e.cw; today.messages++;
      add(byModel, e.model, total(e)); add(byProject, e.project, total(e)); add(bySession, e.session, total(e));
    }
    today.total = today.input + today.output + today.cache_read + today.cache_write;

    // 5-hour blocks, ccusage-style: start floored to the hour; new block after 5h or a 5h gap
    interface Block { start: number; end: number; last: number; tokens: number; output: number; messages: number }
    const blocks: Block[] = [];
    for (const e of entries) {
      let b = blocks[blocks.length - 1];
      if (!b || e.ts >= b.end || e.ts - b.last >= BLOCK_MS) {
        const start = Math.floor(e.ts / 3600e3) * 3600e3;
        b = { start, end: start + BLOCK_MS, last: e.ts, tokens: 0, output: 0, messages: 0 };
        blocks.push(b);
      }
      b.last = e.ts; b.tokens += total(e); b.output += e.out; b.messages++;
    }
    const lastB = blocks[blocks.length - 1];
    const active = lastB && now < lastB.end && now - lastB.last < BLOCK_MS ? lastB : null;
    const past = blocks.filter(b => b !== active).map(b => b.tokens);

    const tenAgo = now - 10 * 60e3;
    const burn = entries.filter(e => e.ts >= tenAgo).reduce((s, e) => s + total(e), 0) / 10;

    const hour0 = Math.floor(now / 3600e3) * 3600e3 - 23 * 3600e3;
    const hourly = new Array<number>(24).fill(0);
    for (const e of entries) {
      if (e.ts < hour0) continue;
      const i = Math.floor((e.ts - hour0) / 3600e3);
      if (i >= 0 && i < 24) hourly[i] += total(e);
    }
    const liveCut = now - 15 * 60e3;
    const sessions = new Set(entries.filter(e => e.ts >= liveCut).map(e => e.session));
    const iso = (t: number) => new Date(t).toISOString();
    const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);

    return {
      now: iso(now),
      today,
      models: sorted(byModel),
      projects: sorted(byProject).slice(0, 4),
      block: active ? { start: iso(active.start), end: iso(active.end), tokens: active.tokens, output: active.output, messages: active.messages } : null,
      peak_block: past.length ? Math.max(...past) : active ? active.tokens : 0,
      burn_per_min: burn,
      hourly,
      hourly_start: iso(hour0),
      active_sessions: sessions.size,
      last_activity: entries.length ? iso(entries[entries.length - 1].ts) : null,
      tokensBySession: bySession,
    };
  }
}
