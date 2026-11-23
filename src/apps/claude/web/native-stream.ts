// SPIKE (native chat, milestone 1): the tablet's own Claude CLI speaks stream-json, one JSON object per line
// (android/.../node/NativeClaudeRunner.java forwards each stdout line as is). Pure: parses a line into an event, and
// folds events into the chat on screen. No DOM, so it runs in node (test/native-stream.test.ts).
import type { TranscriptEntry } from '../api.ts';

export type NativeEvent =
  | { type: 'init'; sessionId: string }
  | { type: 'delta'; text: string }      // a piece of the reply as it streams (--include-partial-messages)
  | { type: 'text'; text: string }       // a whole assistant message
  | { type: 'result'; ok: boolean; text: string; sessionId: string | null; costUsd: number | null; inputTokens: number; outputTokens: number }
  | { type: 'exit'; code: number }       // the process ended (from the runner, not the CLI)
  | { type: 'error'; message: string };  // the runner could not send (from the runner)

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

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
      const usage = obj(o.usage);
      return {
        type: 'result', ok: o.is_error !== true && o.subtype === 'success', text: str(o.result) || '',
        sessionId: str(o.session_id), costUsd: typeof o.total_cost_usd === 'number' ? o.total_cost_usd : null,
        inputTokens: num(usage?.input_tokens), outputTokens: num(usage?.output_tokens),
      };
    }
    case 'exit': return { type: 'exit', code: num(o.code) };
    case 'error': return { type: 'error', message: str(o.message) || 'error' };
    default: return null;
  }
}

/** The chat on screen. partial: the reply streaming in now. */
export interface NativeChat { sessionId: string | null; entries: TranscriptEntry[]; running: boolean; partial: string; error: string | null }
export const emptyChat = (): NativeChat => ({ sessionId: null, entries: [], running: false, partial: '', error: null });

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
        error: e.ok ? null : 'That reply didn’t finish. Try again.' };
    case 'exit':
      return c.running ? { ...c, entries: withReply(c.partial), running: false, partial: '', error: 'Claude on this tablet stopped before it finished.' } : c;
    case 'error':
      return { ...c, running: false, partial: '', error: ERRORS[e.message] || 'That didn’t send. Try again.' };
  }
}
