// Chats on the tablet's own Claude CLI: the CLI speaks stream-json, one JSON object per line
// (android/.../cli/ClaudeCli.java forwards each stdout line as is). Pure: parses a line into an event, and
// folds events into the chat on screen. No DOM, so it runs in node (test/native-stream.test.ts).
import type { TranscriptEntry } from '../api.ts';

/** One plan-limit window as the CLI reported it in a rate_limit_event. type: five_hour, seven_day, seven_day_opus, ...
 *  status: allowed, allowed_warning or rejected ('' when the CLI did not say). used: percent of the window used
 *  (0 to 100), null when the CLI sent no utilization. resetsAt: ISO time, null when unknown. */
export interface PlanLimit { type: string; status: string; used: number | null; resetsAt: string | null }
/** A plan limit kept in the chat, with the time the CLI reported it. */
export interface SeenLimit extends PlanLimit { at: string | null }

/** Tokens of one reply (or the running total). */
export interface TokenUse { input: number; output: number; cacheRead: number; cacheWrite: number }

export type NativeEvent =
  | { type: 'init'; sessionId: string }
  | { type: 'delta'; text: string }      // a piece of the reply as it streams (--include-partial-messages)
  | { type: 'text'; text: string }       // a whole assistant message
  | { type: 'result'; ok: boolean; text: string; sessionId: string | null; costUsd: number | null; usage: TokenUse; window: number | null }
  | { type: 'limits'; limits: PlanLimit[] }   // plan limits the CLI reported (rate_limit_event)
  | { type: 'exit'; code: number }       // the process ended (from the runner, not the CLI)
  | { type: 'error'; message: string };  // the runner could not send (from the runner)

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const NO_TOKENS: TokenUse = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const tokenUse = (o: Obj | null): TokenUse => ({
  input: num(o?.input_tokens ?? o?.input), output: num(o?.output_tokens ?? o?.output),
  cacheRead: num(o?.cache_read_input_tokens ?? o?.cacheRead), cacheWrite: num(o?.cache_creation_input_tokens ?? o?.cacheWrite),
});
const addTokens = (a: TokenUse, b: TokenUse): TokenUse =>
  ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite });

// The CLI sends utilization as a fraction (0.9 = 90% used) and resetsAt as Unix seconds.
const percent = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v * 100)) : null);
const resetTime = (v: unknown): string | null =>
  (typeof v === 'number' && Number.isFinite(v) && v > 0 ? new Date(v < 1e12 ? v * 1000 : v).toISOString() : null);

/** The plan limits in a rate_limit_event's rate_limit_info: the window it names (rateLimitType), and any windows in
 *  unifiedWindows (newer CLIs). The named window's own fields win over its unifiedWindows entry. */
function planLimits(info: Obj): PlanLimit[] {
  const byType = new Map<string, PlanLimit>();
  for (const [type, v] of Object.entries(obj(info.unifiedWindows) || {})) {
    const w = obj(v);
    if (w) byType.set(type, { type, status: str(w.status) || '', used: percent(w.utilization), resetsAt: resetTime(w.resetsAt) });
  }
  const type = str(info.rateLimitType);
  if (type) {
    const old = byType.get(type);
    byType.set(type, { type, status: str(info.status) || old?.status || '', used: percent(info.utilization) ?? old?.used ?? null,
      resetsAt: resetTime(info.resetsAt) ?? old?.resetsAt ?? null });
  }
  return [...byType.values()];
}

/** One stream-json line to an event; null for lines the chat does not use (or that are not JSON). */
export function parseStreamLine(line: string): NativeEvent | null {
  let o: Obj | null;
  try { o = obj(JSON.parse(line)); } catch { return null; }
  if (!o) return null;
  switch (o.type) {
    case 'system': {
      const id = str(o.session_id);
      return o.subtype === 'init' && id ? { type: 'init', sessionId: id } : null;
    }
    case 'stream_event': {
      const e = obj(o.event), d = obj(e?.delta);
      const text = str(d?.text);
      return e?.type === 'content_block_delta' && d?.type === 'text_delta' && text ? { type: 'delta', text } : null;
    }
    case 'assistant': {
      const content = obj(o.message)?.content;
      const text = Array.isArray(content) ? content.map(b => (obj(b)?.type === 'text' ? str(obj(b)!.text) || '' : '')).join('') : '';
      return text ? { type: 'text', text } : null;
    }
    case 'result': {
      // modelUsage is keyed by model id; its contextWindow is the window size the CLI used for the turn
      let window: number | null = null;
      for (const m of Object.values(obj(o.modelUsage) || {})) window = num(obj(m)?.contextWindow) || window;
      return {
        type: 'result', ok: o.is_error !== true && o.subtype === 'success', text: str(o.result) || '',
        sessionId: str(o.session_id), costUsd: typeof o.total_cost_usd === 'number' ? o.total_cost_usd : null,
        usage: tokenUse(obj(o.usage)), window,
      };
    }
    case 'rate_limit_event': {
      const info = obj(o.rate_limit_info);
      const limits = info ? planLimits(info) : [];
      return limits.length ? { type: 'limits', limits } : null;
    }
    case 'exit': return { type: 'exit', code: num(o.code) };
    case 'error': return { type: 'error', message: str(o.message) || 'error' };
    default: return null;
  }
}

/** The chat on screen. partial: the reply streaming in now. tokens: the session total; last: the latest reply's
 *  tokens; window: the context window size (null when the CLI did not say). limits: the latest plan limit per
 *  window type, as of the last chat. */
export interface NativeChat {
  sessionId: string | null; entries: TranscriptEntry[]; running: boolean; partial: string; error: string | null;
  tokens: TokenUse; last: TokenUse | null; window: number | null; limits: Record<string, SeenLimit>;
}
export const emptyChat = (): NativeChat =>
  ({ sessionId: null, entries: [], running: false, partial: '', error: null, tokens: { ...NO_TOKENS }, last: null, window: null, limits: {} });

/** Your message goes on screen and the reply starts. */
export const userSent = (c: NativeChat, text: string, at = new Date().toISOString()): NativeChat =>
  ({ ...c, entries: [...c.entries, { kind: 'user', text, at }], running: true, partial: '', error: null });

const ERRORS: Record<string, string> = { start_failed: 'Claude couldn’t start on this tablet. Sign in under Settings → Apps → Claude, then try again.' };

/** One event folded into the chat. */
export function applyEvent(c: NativeChat, e: NativeEvent, at = new Date().toISOString()): NativeChat {
  const withReply = (text: string): TranscriptEntry[] => (text ? [...c.entries, { kind: 'assistant', text, at }] : c.entries);
  switch (e.type) {
    case 'init': return { ...c, sessionId: e.sessionId };
    case 'delta': return c.running ? { ...c, partial: c.partial + e.text } : c;
    case 'text': return c.running ? { ...c, partial: e.text } : c;
    case 'result':
      return { ...c, entries: withReply(e.text || c.partial), running: false, partial: '', sessionId: e.sessionId || c.sessionId,
        error: e.ok ? null : 'That reply didn’t finish. Try again.',
        tokens: addTokens(c.tokens, e.usage), last: e.usage, window: e.window || c.window };
    case 'limits': {
      const limits = { ...c.limits };
      for (const l of e.limits) limits[l.type] = { ...l, at };
      return { ...c, limits };
    }
    case 'exit':
      return c.running ? { ...c, entries: withReply(c.partial), running: false, partial: '', error: 'Claude on this tablet stopped before it finished.' } : c;
    case 'error':
      return { ...c, running: false, partial: '', error: ERRORS[e.message] || 'That didn’t send. Try again.' };
  }
}

const LIMIT_ORDER = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_overage_included', 'overage'];
const LIMIT_NAMES: Record<string, string> = {
  five_hour: 'Session limit', seven_day: 'Weekly limit', seven_day_opus: 'Weekly limit · Opus', seven_day_sonnet: 'Weekly limit · Sonnet',
  seven_day_overage_included: 'Weekly limit · with extra usage', overage: 'Extra usage',
};
const STATUS_TEXT: Record<string, string> = { allowed: 'Within limit', allowed_warning: 'Close to the limit', rejected: 'Limit reached' };

/** The chat's plan limits: the session window first, then the weekly ones, then any other. */
export const limitList = (c: NativeChat): SeenLimit[] => Object.values(c.limits).sort((a, b) => {
  const i = (t: string) => { const n = LIMIT_ORDER.indexOf(t); return n < 0 ? LIMIT_ORDER.length : n; };
  return i(a.type) - i(b.type) || a.type.localeCompare(b.type);
});
/** A window's name for the screen (the CLI's type for a window this code does not know). */
export const limitName = (type: string): string => LIMIT_NAMES[type] || type;
/** A window's state without the reset time: the percent used when the CLI sent it, otherwise its status. */
export const limitState = (l: PlanLimit): string =>
  l.used != null ? `${Math.round(l.used)}% used` : STATUS_TEXT[l.status] || l.status || 'No status';

/** Tokens the Sessions screen counts for the chat: input, output and cache, as the PC hub totals a session. */
export const totalTokens = (t: TokenUse): number => t.input + t.output + t.cacheRead + t.cacheWrite;

/** The context the latest reply sent, and the window it fits in; null until the CLI reports the window. */
export const contextOf = (c: NativeChat): { used: number; window: number } | null =>
  c.last && c.window ? { used: c.last.input + c.last.cacheRead + c.last.cacheWrite, window: c.window } : null;

/** The Sessions list shows the chat while it has a message or a reply is running, also when the chat is not open. */
export const chatListed = (c: NativeChat): boolean => c.running || c.entries.length > 0;

/** Seconds since the chat's last message (0 while a reply runs, or when no time is known). */
export function chatAge(c: NativeChat, now = Date.now()): number {
  const at = c.running ? NaN : Date.parse(c.entries[c.entries.length - 1]?.at || '');
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 1000)) : 0;
}

// ---------- keeping the chat across page reloads and app restarts (native.ts keeps the JSON in the store and in a
// file in the app's files folder) ----------
const SAVED_ENTRIES = 100;

/** The chat as JSON for the store: the session, the entries and the token counts. Never the streaming reply.
 *  savedAt: when it was saved (ms), so the newer of two copies wins (newerSaved). */
export function saveChat(c: NativeChat, savedAt = Date.now()): string {
  return JSON.stringify({ v: 1, savedAt, sessionId: c.sessionId, entries: c.entries.slice(-SAVED_ENTRIES), tokens: c.tokens, last: c.last, window: c.window, limits: c.limits });
}

/** Of the copy in the app's file and the copy in localStorage, the one saved last (the file on a tie, or when the
 *  other is missing or unreadable). localStorage can lag behind the file when the app was closed right after a save;
 *  the file can be missing on an older app build. */
export function newerSaved(file: string | null, local: string | null): string | null {
  const at = (s: string | null): number => {
    try { const o = obj(s ? JSON.parse(s) : null); return o && o.v === 1 ? num(o.savedAt) || 0 : -1; } catch { return -1; }
  };
  const f = at(file), l = at(local);
  if (f < 0 && l < 0) return file ?? local;
  return l > f ? local : file;
}

/** The chat from the store's JSON. Anything unreadable gives an empty chat; a reply that was streaming is not kept. */
export function loadChat(s: string | null): NativeChat {
  try {
    const o = obj(s ? JSON.parse(s) : null);
    if (!o || o.v !== 1) return emptyChat();
    const entries: TranscriptEntry[] = [];
    for (const e of Array.isArray(o.entries) ? o.entries : []) {
      const x = obj(e), kind = x?.kind;
      if ((kind === 'user' || kind === 'assistant' || kind === 'tool' || kind === 'note') && typeof x?.text === 'string')
        entries.push({ kind, text: x.text, at: str(x.at) });
    }
    const limits: Record<string, SeenLimit> = {};
    for (const [type, v] of Object.entries(obj(o.limits) || {})) {
      const l = obj(v);
      if (l) limits[type] = { type, status: str(l.status) || '', used: typeof l.used === 'number' && Number.isFinite(l.used) ? l.used : null,
        resetsAt: str(l.resetsAt), at: str(l.at) };
    }
    return { ...emptyChat(), sessionId: str(o.sessionId), entries: entries.slice(-SAVED_ENTRIES), tokens: tokenUse(obj(o.tokens)),
      last: o.last ? tokenUse(obj(o.last)) : null, window: num(o.window) || null, limits };
  } catch { return emptyChat(); }
}
