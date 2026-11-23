// SPIKE (native chat, milestone 1): the tablet's own Claude CLI speaks stream-json, one JSON object per line
// (android/.../node/NativeClaudeRunner.java forwards each stdout line as is). Pure: parses a line into an event, and
// folds events into the chat on screen. No DOM, so it runs in node (test/native-stream.test.ts).
import type { TranscriptEntry } from '../api.ts';

/** Tokens of one reply (or the running total). */
export interface TokenUse { input: number; output: number; cacheRead: number; cacheWrite: number }

export type NativeEvent =
  | { type: 'init'; sessionId: string }
  | { type: 'delta'; text: string }      // a piece of the reply as it streams (--include-partial-messages)
  | { type: 'text'; text: string }       // a whole assistant message
  | { type: 'result'; ok: boolean; text: string; sessionId: string | null; costUsd: number | null; usage: TokenUse; window: number | null }
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
    case 'exit': return { type: 'exit', code: num(o.code) };
    case 'error': return { type: 'error', message: str(o.message) || 'error' };
    default: return null;
  }
}

/** The chat on screen. partial: the reply streaming in now. tokens: the session total; last: the latest reply's
 *  tokens; window: the context window size (null when the CLI did not say). */
export interface NativeChat {
  sessionId: string | null; entries: TranscriptEntry[]; running: boolean; partial: string; error: string | null;
  tokens: TokenUse; last: TokenUse | null; window: number | null;
}
export const emptyChat = (): NativeChat => ({ sessionId: null, entries: [], running: false, partial: '', error: null, tokens: { ...NO_TOKENS }, last: null, window: null });

/** Your message goes on screen and the reply starts. */
export const userSent = (c: NativeChat, text: string, at = new Date().toISOString()): NativeChat =>
  ({ ...c, entries: [...c.entries, { kind: 'user', text, at }], running: true, partial: '', error: null });

const ERRORS: Record<string, string> = { start_failed: 'Claude couldn’t start on this tablet. Sign the CLI in first, then try again.' };

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
    case 'exit':
      return c.running ? { ...c, entries: withReply(c.partial), running: false, partial: '', error: 'Claude on this tablet stopped before it finished.' } : c;
    case 'error':
      return { ...c, running: false, partial: '', error: ERRORS[e.message] || 'That didn’t send. Try again.' };
  }
}

/** Tokens the Sessions screen counts for the chat: input, output and cache, as the PC hub totals a session. */
export const totalTokens = (t: TokenUse): number => t.input + t.output + t.cacheRead + t.cacheWrite;

/** The context the latest reply sent, and the window it fits in; null until the CLI reports the window. */
export const contextOf = (c: NativeChat): { used: number; window: number } | null =>
  c.last && c.window ? { used: c.last.input + c.last.cacheRead + c.last.cacheWrite, window: c.window } : null;

// ---------- keeping the chat across page reloads (native.ts keeps the JSON in the store) ----------
const SAVED_ENTRIES = 100;

/** The chat as JSON for the store: the session, the entries and the token counts. Never the streaming reply. */
export function saveChat(c: NativeChat): string {
  return JSON.stringify({ v: 1, sessionId: c.sessionId, entries: c.entries.slice(-SAVED_ENTRIES), tokens: c.tokens, last: c.last, window: c.window });
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
    return { ...emptyChat(), sessionId: str(o.sessionId), entries: entries.slice(-SAVED_ENTRIES), tokens: tokenUse(obj(o.tokens)),
      last: o.last ? tokenUse(obj(o.last)) : null, window: num(o.window) || null };
  } catch { return emptyChat(); }
}
