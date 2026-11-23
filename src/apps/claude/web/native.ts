// Chats that run on the tablet's own Claude CLI (android/.../cli/ClaudeCli.java) instead of the PC hub.
// Settings → Apps → Claude → "Run Claude chats on this tablet" (off: the PC hub, the default). When on, a new chat
// from the Sessions screen goes to device.claudeSend; the tablet sends each stream-json line back as
// window.hubClaudeNative(line). One native chat at a time. The chat (its session id and entries) is kept in the store
// and in the app's files folder, so a reload or an app restart resumes it; the screen shows it as the session NATIVE_ID.
import { appSettingsChanged } from '../../../core/web/app-settings.ts';
import { device, nativeHas } from '../../../core/web/device.ts';
import { store } from '../../../core/web/dom.ts';
import { alertFor } from '../../../core/web/system.ts';
import type { LiveSession, SessionView } from '../api.ts';
import {
  applyEvent, chatAge, chatListed, clearedChat, contextOf, emptyChat, glanceOf, lastTurnText, limitList, loadChat, newerSaved, parseStreamLine, replyFinished,
  saveChat, STALLED_TEXT, stalled, totalTokens, usageStale, userSent, type NativeChat, type NativeGlance, type SeenLimit,
} from './native-stream.ts';

const KEY = 'claude.native.on';
export const nativeOn = (): boolean => store.get(KEY) === '1';
export const setNativeOn = (on: boolean): void => store.set(KEY, on ? '1' : null);
export const NATIVE_ID = 'native';

const CHAT_KEY = 'claude.native.chat';
const MODEL_KEY = 'claude.native.model';
/** The models a native chat can run on. Anything else reads as Haiku (the Java side checks the same list). */
export const NATIVE_MODELS = [{ value: 'haiku', label: 'Haiku' }, { value: 'sonnet', label: 'Sonnet' }, { value: 'opus', label: 'Opus' }];
export const nativeModel = (): string => {
  const m = store.get(MODEL_KEY);
  return NATIVE_MODELS.some(o => o.value === m) ? m! : 'haiku';
};
export const setNativeModel = (m: string): void => store.set(MODEL_KEY, NATIVE_MODELS.some(o => o.value === m) ? m : 'haiku');

// The chat is kept twice: in localStorage, and in a file in the app's files folder (device.pageFileWrite). The file is
// on disk as soon as the save returns; localStorage reaches disk a few seconds later, so closing the app right after a
// reply could lose it there. At start-up the newer copy wins (newerSaved).
const CHAT_FILE = 'native-chat';
function readFile(): string | null { try { return device.pageFileRead(CHAT_FILE); } catch { return null; } }
let chat: NativeChat = loadChat(newerSaved(readFile(), store.get(CHAT_KEY)));
let changed = (): void => {};

/** Keep the chat for the next page load and the next app start. Called after each change that is not a streamed piece. */
function save(): void {
  const s = saveChat(chat);
  store.set(CHAT_KEY, s);
  try { device.pageFileWrite(CHAT_FILE, s); } catch { /* older app build, or off the tablet: localStorage only */ }
}

// The tablet's events, listened for from the start: the Settings app's usage check needs them also when the Claude
// app has not been opened yet.
(window as unknown as { hubClaudeNative: (line: string) => void }).hubClaudeNative = line => {
  const e = typeof line === 'string' ? parseStreamLine(line) : null;
  if (!e) return;
  if (e.type === 'usageChecked') { checking = false; checkFailed = !e.ok; appSettingsChanged(); return; }
  // a start that failed reads as a sign-in problem when the sign-in state says so, else as a network or start problem
  const before = chat;
  chat = applyEvent(chat, e.type === 'error' && e.message === 'start_failed'
    ? { type: 'error', message: device.cliAuthState().signedIn === 0 ? 'not_signed_in' : 'start_failed' } : e);
  // a reply that ends well raises "Claude finished", as a PC turn does (reply.ts onUsage)
  if (replyFinished(before, chat)) alertFor('done', { title: 'Claude finished', body: nativeView().session?.title, app: 'claude' });
  chat = { ...chat, lastEventAt: Date.now() };   // the stall line (nativeView) counts from the last event
  if (e.type !== 'delta' && e.type !== 'text') save();
  changed();
  if (e.type === 'limits') appSettingsChanged();   // Settings (Usage, and Apps -> Claude) shows them
};

/** onChange runs after each tablet event the chat uses (the Claude app's Sessions screen). */
export function initNative(onChange: () => void): void { changed = onChange; }

/** The plan limits from the tablet CLI (rate_limit_event of a chat, or a usage check), the newest per window.
 *  Not the hub's limits. */
export const nativeLimits = (): SeenLimit[] => limitList(chat);
/** The tablet chat at a glance (running, the last reply's time, any error) for Home. Never the reply text. */
export const nativeGlance = (): NativeGlance => glanceOf(chat);
/** The tablet CLI's version as its last chat reported it (system/init), or null before the first chat. */
export const nativeCliVersion = (): string | null => chat.cliVersion;

// ---------- the usage check (Settings → Usage): the CLI's get_usage, with no prompt (no usage spent) ----------
let checking = false;
let checkFailed = false;
/** The tablet can run a usage check (a newer app build). */
export const usageCheckable = (): boolean => nativeHas('claudeUsageCheck');
/** The state of the last usage check: running now, or ended without an answer. */
export const usageCheck = (): { running: boolean; failed: boolean } => ({ running: checking, failed: checkFailed });

/** Asks the tablet's CLI for the plan limits when the newest are older than maxAgeMs (or there are none). The answer
 *  comes back as tablet events; Settings repaints on appSettingsChanged. */
export function checkUsage(maxAgeMs: number): void {
  if (checking || !usageCheckable() || !usageStale(nativeLimits(), maxAgeMs)) return;
  checking = true; checkFailed = false;
  try { device.claudeUsageCheck(); } catch { checking = false; checkFailed = true; }
  appSettingsChanged();
}

/** A message to the native chat (a fresh chat when `fresh`). The reply resumes the chat's session, on the chosen model. */
export function nativeSend(text: string, fresh = false): void {
  if (fresh) chat = { ...emptyChat(), limits: chat.limits };   // plan limits belong to the account, not to one chat
  chat = userSent(chat, text);
  try { device.claudeSend(text, chat.sessionId || '', nativeModel()); } catch { chat = applyEvent(chat, { type: 'error', message: 'send' }); }
  save();
  changed();
}

/** Stops the running reply. Its end then reads as "Stopped" (native-stream.ts), not as an error. */
export function nativeStop(): void {
  chat = applyEvent(chat, { type: 'stop' });
  changed();
  try { device.claudeStop(); } catch { /* older app build */ }
}

/** True while a reply runs. The chat cannot be cleared then. */
export const nativeBusy = (): boolean => chat.running;

/** Clears the tablet chat from the list and the screen. The CLI's session files stay, and no new chat starts: the next
 *  message starts a fresh chat. Only when no reply runs (nativeBusy). */
export function nativeClear(): void {
  if (chat.running) return;
  chat = clearedChat(chat);
  save();
  changed();
}

/** The native chat as a row of the Sessions list, or null when there is no chat yet. The hub's list never has it. */
export const nativeListed = (): LiveSession | null => (chatListed(chat) ? nativeView().session : null);

/** The subtitle under the chat's title: the latest turn's model and time ("Haiku · 8 s"). */
export const nativeMetaText = (): string => lastTurnText(chat);

/** The native chat as the Sessions screen draws a session. */
export function nativeView(): SessionView {
  const c = chat, now = new Date().toISOString();
  const first = c.entries.find(e => e.kind === 'user')?.text || 'New chat';
  const title = first.length > 40 ? `${first.slice(0, 39)}…` : first;
  const transcript = [...c.entries];
  if (c.running && c.partial) transcript.push({ kind: 'assistant', text: c.partial, at: now });
  if (!c.running && c.error) transcript.push({ kind: 'note', text: c.error, at: null });
  return {
    session: { id: NATIVE_ID, title, folder: 'On this tablet', branch: null, model: nativeModel(), state: c.running ? 'thinking' : 'waiting', tool: null,
      age: chatAge(c), subagents: 0, working: 0, tokens: totalTokens(c.tokens), surface: 'tablet', open: false, hub: true },
    transcript, lastText: null, canReply: !c.running, reason: null, context: contextOf(c),
    turn: c.running ? { id: NATIVE_ID, sessionId: NATIVE_ID, title, status: 'running', startedAt: c.turnStartedAt || now, progress: [stalled(Date.now(), c.lastEventAt) ? STALLED_TEXT : c.status || (c.partial ? 'Writing' : 'Thinking')],
      approval: null, reply: null, error: null } : null,
  };
}
