// SPIKE (native chat, milestone 1): chats that run on the tablet's own Claude CLI instead of the PC hub.
// Settings → Apps → Claude → "Run Claude chats on this tablet" (off: the PC hub, the default). When on, a new chat
// from the Sessions screen goes to device.claudeSend; the tablet sends each stream-json line back as
// window.hubClaudeNative(line). One native chat at a time, kept in memory; the screen shows it as the session NATIVE_ID.
import { device } from '../../../core/web/device.ts';
import { store } from '../../../core/web/dom.ts';
import type { SessionView } from '../api.ts';
import { applyEvent, emptyChat, parseStreamLine, userSent, type NativeChat } from './native-stream.ts';

const KEY = 'claude.native.on';
export const nativeOn = (): boolean => store.get(KEY) === '1';
export const setNativeOn = (on: boolean): void => store.set(KEY, on ? '1' : null);
export const NATIVE_ID = 'native';

let chat: NativeChat = emptyChat();
let changed = (): void => {};

/** Listen for the tablet's events; onChange runs after each one the chat uses. */
export function initNative(onChange: () => void): void {
  changed = onChange;
  (window as unknown as { hubClaudeNative: (line: string) => void }).hubClaudeNative = line => {
    const e = typeof line === 'string' ? parseStreamLine(line) : null;
    if (!e) return;
    chat = applyEvent(chat, e);
    changed();
  };
}

/** A message to the native chat (a fresh chat when `fresh`). */
export function nativeSend(text: string, fresh = false): void {
  if (fresh) chat = emptyChat();
  chat = userSent(chat, text);
  try { device.claudeSend(text, chat.sessionId || ''); } catch { chat = applyEvent(chat, { type: 'error', message: 'send' }); }
  changed();
}

export function nativeStop(): void { try { device.claudeStop(); } catch { /* older app build */ } }

/** The native chat as the Sessions screen draws a session. */
export function nativeView(): SessionView {
  const c = chat, now = new Date().toISOString();
  const first = c.entries.find(e => e.kind === 'user')?.text || 'New chat';
  const title = first.length > 40 ? `${first.slice(0, 39)}…` : first;
  const transcript = [...c.entries];
  if (c.running && c.partial) transcript.push({ kind: 'assistant', text: c.partial, at: now });
  if (!c.running && c.error) transcript.push({ kind: 'note', text: c.error, at: null });
  return {
    session: { id: NATIVE_ID, title, folder: 'On this tablet', branch: null, model: 'haiku', state: c.running ? 'thinking' : 'waiting', tool: null,
      age: 0, subagents: 0, working: 0, tokens: 0, surface: 'tablet', open: false, hub: true },
    transcript, lastText: null, canReply: !c.running, reason: null,
    turn: c.running ? { id: NATIVE_ID, sessionId: NATIVE_ID, title, status: 'running', startedAt: now, progress: [c.partial ? 'Writing' : 'Thinking'],
      approval: null, reply: null, error: null } : null,
  };
}
