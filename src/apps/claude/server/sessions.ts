// Live sessions: read the tail of recently-written session logs to tell what each is doing.
import fs from 'node:fs';
import path from 'node:path';
import type { LiveSession, NextStep, SessionState, TranscriptEntry } from '../api.ts';
import { describeTool } from './describe.ts';
import { type ChoiceEvent, currentChoices, WRAP_UP_TOOL } from '../web/sessions/next-step.ts';
import { tabletReplyIn } from './pclink.ts';
import { PROJECTS } from '../../../core/server/paths.ts';
import { openSessions } from './registry.ts';
import { folderOf, hubSession, hubSessionIds } from './hubsessions.ts';
import { archivedIds } from './state.ts';
import { Lru } from './lru.ts';

const LIVE_WINDOW_MS = 30 * 60e3;   // quieter sessions are not listed
const TAIL = 400_000;

interface Info {
  id: string | null; title: string | null; agent: string | null; prompt: string | null;
  cwd: string | null; branch: string | null; model: string | null;
  state: SessionState | null; tool: string | null; last: string | null; entry: string | null;
  lastText: string | null;     // Claude's most recent words in this session
}

/** Server-only details the Hub never sees directly (paths stay on this PC). */
export interface SessionDetail { id: string; cwd: string; file: string; model: string | null; lastText: string | null; live: LiveSession }
const details = new Map<string, SessionDetail>();
export const lookupSession = (id: string): SessionDetail | undefined => details.get(id) || findSession(id);
const cache = new Map<string, { key: string; info: Info }>();

function contentKinds(msg: any): { kinds: string[]; tool: string | null } {
  const c = msg?.content;
  if (typeof c === 'string') return { kinds: ['text'], tool: null };
  const kinds: string[] = []; let tool: string | null = null;
  for (const x of Array.isArray(c) ? c : []) {
    if (x && typeof x === 'object') {
      kinds.push(x.type);
      if (x.type === 'tool_use') tool = x.name;
    }
  }
  return { kinds, tool };
}

function readSession(file: string): Info {
  const st = fs.statSync(file);
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = cache.get(file);
  if (hit && hit.key === key) return hit.info;

  const start = Math.max(0, st.size - TAIL);
  const buf = Buffer.alloc(st.size - start);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
  const lines = buf.toString('utf8').split('\n');
  if (start > 0) lines.shift();   // first line is probably partial

  const info: Info = { id: null, title: null, agent: null, prompt: null, cwd: null, branch: null,
    model: null, state: null, tool: null, last: null, entry: null, lastText: null };
  for (const raw of lines) {
    let o: any;
    try { o = JSON.parse(raw); } catch { continue; }
    const t: string = o.type;
    info.id = o.sessionId || info.id;
    if (t === 'custom-title' && o.customTitle) info.title = o.customTitle;
    else if (t === 'agent-name' && o.agentName) info.agent = o.agentName;
    else if (t === 'last-prompt' && o.lastPrompt) info.prompt = o.lastPrompt;
    if (o.isSidechain) continue;
    if (o.cwd) info.cwd = o.cwd;
    if (o.gitBranch) info.branch = o.gitBranch;
    if (o.entrypoint) info.entry = o.entrypoint;
    if (t === 'assistant') {
      const msg = o.message || {};
      if (msg.model && msg.model !== '<synthetic>') info.model = msg.model;
      const { kinds, tool } = contentKinds(msg);
      const text = Array.isArray(msg.content) ? msg.content.filter((x: any) => x?.type === 'text').map((x: any) => x.text).join('\n').trim() : '';
      if (text) info.lastText = text.length > 1500 ? text.slice(0, 1500) + '…' : text;
      const stop = msg.stop_reason || o.stopReason;
      if (tool) { info.state = 'tool'; info.tool = tool; }
      else if (stop === 'end_turn' || (kinds.includes('text') && stop !== 'tool_use')) { info.state = 'waiting'; info.tool = null; }
      else { info.state = 'thinking'; info.tool = null; }
    } else if (t === 'user' && !o.isMeta) {
      // an interrupted turn ends with a "[Request interrupted by user…]" note: that's the user's move again
      const c = o.message?.content;
      const said = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: any) => x?.text || '').join(' ') : '';
      info.state = said.includes('[Request interrupted by user') ? 'waiting' : 'thinking';
      info.tool = null;
    } else if (t === 'api-request') {
      info.state = 'thinking';
    } else if (t === 'system' && (o.subtype === 'stop_hook_summary' || o.subtype === 'turn_duration')) {
      info.state = 'waiting'; info.tool = null;
    }
    if (o.timestamp && ['user', 'assistant', 'api-request', 'system'].includes(t)) info.last = o.timestamp;
  }
  cache.set(file, { key, info });
  return info;
}

/** What one log says about its session right now (from the tail of the log). */
function describe(file: string, now: number, open: Set<string> | Map<string, unknown>, hubIds: Set<string>, tokensBySession: Map<string, number>, minAge = 0): SessionDetail | null {
  const s = readSession(file);
  if (!s.last) return null;
  const last = Date.parse(s.last);
  if (Number.isNaN(last)) return null;
  const age = Math.max((now - last) / 1000, minAge);
  let state: SessionState = s.state || 'waiting';
  if ((state === 'thinking' || state === 'tool') && age > 600) state = 'stalled';
  // helper agents still writing for this session
  const subDir = path.join(file.replace(/\.jsonl$/, ''), 'subagents');
  let subagents = 0;
  try {
    subagents = fs.readdirSync(subDir).filter(n => n.endsWith('.jsonl') && now - fs.statSync(path.join(subDir, n)).mtimeMs < 60e3).length;
  } catch { /* none */ }
  const fo = folderOf(s.cwd);
  const fromHub = !!(s.id && hubIds.has(s.id));
  const title = s.title || s.agent || (fromHub && s.id ? hubSession(s.id)?.title : null) || (s.prompt || '').slice(0, 60) || fo.name || 'Session';
  const live: LiveSession = { id: s.id, title, folder: fo.name, folderId: fo.id, branch: s.branch, model: s.model, state, tool: s.tool,
    age: Math.round(age), subagents, tokens: (s.id && tokensBySession.get(s.id)) || 0, surface: s.entry,
    open: !!(s.id && open.has(s.id)), hub: fromHub };
  return s.id && s.cwd ? { id: s.id, cwd: s.cwd, file, model: s.model, lastText: s.lastText, live } : { id: '', cwd: '', file, model: null, lastText: null, live };
}

export function liveSessions(tokensBySession: Map<string, number>): LiveSession[] {
  const now = Date.now();
  const out: LiveSession[] = [];
  let dirs: string[] = [];
  try { dirs = fs.readdirSync(PROJECTS); } catch { return out; }
  const open = openSessions();
  const hubIds = hubSessionIds();
  const archived = archivedIds();
  details.clear();
  lastTokens = tokensBySession;
  for (const d of dirs) {
    let files: string[] = [];
    try { files = fs.readdirSync(path.join(PROJECTS, d)).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const file = path.join(PROJECTS, d, f);
      let r: SessionDetail | null;
      try {
        // Hub-started sessions stay listed however long they've been quiet
        if (now - fs.statSync(file).mtimeMs > LIVE_WINDOW_MS && !hubIds.has(f.slice(0, -6))) continue;
        r = describe(file, now, open, hubIds, tokensBySession);
      } catch { continue; }
      if (!r) continue;
      if (r.id) details.set(r.id, r);
      if (!archived.has(r.live.id ?? '')) out.push(r.live);   // archived ones stay readable, just not listed
    }
  }
  const order: Record<SessionState, number> = { tool: 0, thinking: 0, waiting: 1, stalled: 2 };
  return out.sort((a, b) => order[a.state] - order[b.state] || a.age - b.age);
}

/**
 * Any session on the PC, live or not (for opening an old one from the history). Its age is never
 * younger than its log file, so the reply rules in turns.ts treat it exactly as before.
 */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function findSession(id: string): SessionDetail | undefined {
  if (!ID.test(id)) return undefined;
  let dirs: string[] = [];
  try { dirs = fs.readdirSync(PROJECTS); } catch { return undefined; }
  const now = Date.now();
  for (const d of dirs) {
    const file = path.join(PROJECTS, d, id + '.jsonl');
    let st: fs.Stats;
    try { st = fs.statSync(file); } catch { continue; }
    try {
      const r = describe(file, now, openSessions(), hubSessionIds(), lastTokens, (now - st.mtimeMs) / 1000);
      if (r?.id === id) { details.set(id, r); return r; }
    } catch { /* unreadable */ }
  }
  return undefined;
}
let lastTokens = new Map<string, number>();

// ---------- the conversation itself, for the Hub's session view ----------
const TRANSCRIPT_SPANS = [1_500_000, 5_000_000, 12_000_000], MAX_ENTRIES = 80;
const transcripts = new Lru<string, { key: string; entries: TranscriptEntry[]; next: NextStep | null }>(40);   // the sessions recently viewed

/** Text the user typed, without Claude Code's own wrappers (system reminders, command echoes…). */
export function userText(content: any): string {
  const raw = typeof content === 'string' ? content
    : Array.isArray(content) ? content.filter((x: any) => x?.type === 'text').map((x: any) => x.text).join('\n') : '';
  return raw.replace(/<(system-reminder|local-command-stdout|local-command-stderr|command-message|command-args)>[\s\S]*?<\/\1>/g, '')
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, '$1').trim();
}

/** The key of the transcript cached for a session (its log's size and mtime). Call transcriptFor first. */
export function transcriptVersion(id: string): string {
  return transcripts.get(id)?.key ?? '';
}

/** The choices of the session's latest wrap_up call, when no user message came after it. Call transcriptFor first. */
export function nextStepFor(id: string): NextStep | null {
  return transcripts.get(id)?.next ?? null;
}

export function transcriptFor(id: string): TranscriptEntry[] {
  const s = details.get(id);
  if (!s) return [];
  let st: fs.Stats;
  try { st = fs.statSync(s.file); } catch { return []; }
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = transcripts.get(id);
  if (hit && hit.key === key) return hit.entries;

  // Logs can hold a few huge lines near the end (request snapshots): read further back until there's enough to show
  let out: TranscriptEntry[] = [], next: NextStep | null = null;
  for (const span of TRANSCRIPT_SPANS) {
    const start = Math.max(0, st.size - span);
    ({ entries: out, next } = parseTranscript(id, s.file, start, st.size));
    if (start === 0 || out.filter(e => e.kind !== 'tool').length >= MAX_ENTRIES / 2) break;
  }
  const entries = out.slice(-MAX_ENTRIES);
  transcripts.set(id, { key, entries, next });
  return entries;
}

/**
 * Where the photos of a message sit in its log line, so they can be read back when the page asks for them.
 * Keyed by session, message id and photo number. Photos are never copied out of the log.
 */
const imageSpots = new Lru<string, { file: string; off: number; len: number; n: number }>(500);
const spotKey = (sessionId: string, uuid: string, n: number) => `${sessionId}|${uuid}|${n}`;
const MSG_ID = /^[\w-]{8,64}$/;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** One photo a message carried, straight from its log line (or null if it isn't there any more). */
export function imageBytes(sessionId: string, uuid: string, n: number): { type: string; data: Buffer } | null {
  const spot = imageSpots.get(spotKey(sessionId, uuid, n));
  if (!spot) return null;
  try {
    const buf = Buffer.alloc(spot.len);
    const fd = fs.openSync(spot.file, 'r');
    try { fs.readSync(fd, buf, 0, buf.length, spot.off); } finally { fs.closeSync(fd); }
    const o = JSON.parse(buf.toString('utf8'));
    if (o.uuid !== uuid) return null;
    const block = (Array.isArray(o.message?.content) ? o.message.content : []).filter((x: any) => x?.type === 'image')[spot.n];
    const type = block?.source?.media_type;
    if (block?.source?.type !== 'base64' || typeof block.source.data !== 'string' || !IMAGE_TYPES.includes(type)) return null;
    return { type, data: Buffer.from(block.source.data, 'base64') };
  } catch { return null; }
}

/** Drop what the Hub remembers about one session's transcript (after it is deleted). */
export function forgetTranscript(sessionId: string): void {
  transcripts.delete(sessionId);
  details.delete(sessionId);
  for (const k of [...imageSpots.keys()]) if (k.startsWith(sessionId + '|')) imageSpots.delete(k);
}

function parseTranscript(sessionId: string, file: string, start: number, size: number): { entries: TranscriptEntry[]; next: NextStep | null } {
  const buf = Buffer.alloc(size - start);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
  // split on newlines in bytes, so every line knows where it sits in the file
  const lines: { raw: Buffer; off: number }[] = [];
  for (let p = 0; p < buf.length;) {
    let nl = buf.indexOf(10, p);
    if (nl === -1) nl = buf.length;
    lines.push({ raw: buf.subarray(p, nl), off: start + p });
    p = nl + 1;
  }
  if (start > 0) lines.shift();

  const out: TranscriptEntry[] = [];
  const events: ChoiceEvent[] = [];   // user messages and wrap_up calls, for the next-step choices
  const seen = new Set<string>();
  for (const { raw: rawBuf, off } of lines) {
    const raw = rawBuf.toString('utf8');
    // bookkeeping lines lead with their type (request snapshots can be huge): skip them unparsed
    if (raw.startsWith('{"type":"') && !raw.startsWith('{"type":"user"') && !raw.startsWith('{"type":"assistant"')) continue;
    let o: any;
    try { o = JSON.parse(raw); } catch { continue; }
    if (o.isSidechain || o.isMeta) continue;
    if (o.uuid) { if (seen.has(o.uuid)) continue; seen.add(o.uuid); }
    const at = o.timestamp || null;
    if (o.type === 'user') {
      const c = o.message?.content;
      if (Array.isArray(c) && c.some((x: any) => x?.type === 'tool_result') && !c.some((x: any) => x?.type === 'text')) continue;   // tool output
      const text = userText(c);
      const photos: any[] = Array.isArray(c) ? c.filter((x: any) => x?.type === 'image') : [];
      if (!text && !photos.length) continue;
      const reply = tabletReplyIn(text);   // a reply from the tablet, stored as a hook note: show only the reply
      if (reply === '') continue;
      const shown = reply ?? text;
      events.push({ kind: 'user' });
      if (shown.startsWith('[Request interrupted')) out.push({ kind: 'note', text: 'Interrupted', at });
      else {
        const images: string[] = [];
        if (o.uuid && MSG_ID.test(o.uuid)) {
          photos.forEach((_, n) => {
            imageSpots.set(spotKey(sessionId, o.uuid, n), { file, off, len: rawBuf.length, n });
            images.push(`/api/claude/image?s=${encodeURIComponent(sessionId)}&m=${encodeURIComponent(o.uuid)}&n=${n}`);
          });
        }
        out.push({ kind: 'user', text: shown.slice(0, 4000), at, ...(images.length ? { images } : {}), ...(o.uuid && MSG_ID.test(o.uuid) ? { id: o.uuid } : {}) });
      }
    } else if (o.type === 'assistant') {
      const blocks: any[] = Array.isArray(o.message?.content) ? o.message.content : [];
      blocks.forEach((b: any, bi: number) => {
        const mid = o.uuid && MSG_ID.test(o.uuid) ? (bi ? `${o.uuid}#${bi}` : o.uuid) : undefined;
        if (b?.type === 'text' && b.text?.trim()) out.push({ kind: 'assistant', text: b.text.trim().slice(0, 8000), at, ...(mid ? { id: mid } : {}) });
        else if (b?.type === 'tool_use') {
          if (b.name === WRAP_UP_TOOL) events.push({ kind: 'wrap_up', input: b.input });
          const d = describeTool(b.name, b.input);
          out.push({ kind: 'tool', text: d.summary, tool: b.name, detail: d.detail.slice(0, 300), at });
        }
      });
    }
  }
  return { entries: out, next: currentChoices(events) };
}