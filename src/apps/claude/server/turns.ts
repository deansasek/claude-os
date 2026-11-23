// Replying to a Claude Code session from the Hub, through the Claude Agent SDK.
// A "turn" resumes the session by id in its own folder, sends one message, streams
// progress, and stops to ask the Hub whenever Claude Code would normally ask you.
//
// Rules: only sessions active in the last 30 minutes (or started from the Hub); never one open in a
// Claude Code window (two turns would collide); the session's own permission settings
// always apply (no bypass); unanswered approvals are denied after 3 minutes.
//
// Session controls: each turn runs with a model, an effort and a permission mode (Auto, Manual,
// Accept edits or Plan) picked on the tablet. 'bypassPermissions' is never used, whatever is asked.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { query, type ModelInfo, type PermissionMode, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Approval, ContextUse, HubEffort, HubPermission, HubTurn, ModelChoice, ModelList, NewSessionResult, ReplyBlock, SessionSettings, SessionView, TurnStatus } from '../api.ts';
import { projectFolder, rememberHubSession, SCRATCH } from './hubsessions.ts';
import { logAction } from './guard.ts';
import { askFor, describeTool } from './describe.ts';
import { lookupSession, nextStepFor, transcriptFor, transcriptVersion } from './sessions.ts';
import { Lru } from './lru.ts';
import { pinnedIn } from './state.ts';
import { MAX_PER_ASK, readPhoto } from '../../photos/server/store.ts';
import { profileForPrompt } from '../../settings/server/profile.ts';
import { instructionsForPrompt } from '../../settings/server/instructions.ts';
import { turnPluginOptions } from '../../settings/server/plugins.ts';
import { browserServer } from './browser.ts';
import { tabletServer } from './tablet.ts';
import { haServer } from '../../home-assistant/server/tools.ts';
import { listsServer } from '../../lists/server/tools.ts';
import { calendarServer } from '../../calendar/server/tools.ts';
import { weatherServer } from '../../weather/server/tools.ts';
import { routinesServer } from '../../routines/server/tools.ts';
import { PcInbox, rewakeText, type PcDecision, type WaitAnswer } from './pclink.ts';
import { openSessions } from './registry.ts';
import { failedSentence } from '../web/failed.ts';
import { COMPACTING_TEXT, durationText, retryText, STALLED_TEXT, stalled } from '../web/native-stream.ts';

const APPROVAL_MS = 3 * 60e3;
const MAX_RUNNING = 2;
const KEEP_FINISHED_MS = 10 * 60e3;
/** What a photo-only message asks, when no words came with it. */
const PHOTO_QUESTION = 'What do you see in this photo?';

/** A photo the message carries: its id and its JPEG bytes. */
interface LoadedPhoto { id: string; data: Buffer }

/** The photos named in a message, read from photos. One deleted since it was picked is left out, not an error. */
export function loadPhotos(ids: string[]): { ok: true; photos: LoadedPhoto[] } | { ok: false; error: string } {
  if (ids.length > MAX_PER_ASK) return { ok: false, error: 'too_many_photos' };
  const photos: LoadedPhoto[] = [];
  for (const id of ids) {
    const data = readPhoto(id);
    if (data) photos.push({ id, data });
  }
  return { ok: true, photos };
}

/**
 * The prompt for a turn: plain text, or with photos a streamed SDK user message whose content is
 * the images (as base64 JPEG blocks) followed by the text (Agent SDK: query() takes an AsyncIterable of SDKUserMessage).
 */
function promptFor(text: string, photos: LoadedPhoto[], held: Promise<void>): string | AsyncIterable<SDKUserMessage> {
  if (!photos.length) return text;
  const content = [
    ...photos.map(p => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: p.data.toString('base64') } })),
    { type: 'text' as const, text },
  ];
  const message = { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null } as unknown as SDKUserMessage;
  // the input stays open until the turn ends: permission prompts (canUseTool) travel over it
  return (async function* () { yield message; await held; })();
}

// ---------- models, effort, permission modes ----------
const MODES: readonly HubPermission[] = ['auto', 'default', 'acceptEdits', 'plan'];
const EFFORTS: readonly HubEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const FALLBACK_MODELS: ModelChoice[] = [
  ['claude-opus-5-5', 'Opus 5.5', 'Best for everyday, complex tasks'],
  ['claude-fable-5-2', 'Fable 5.2', 'Most capable for your hardest and longest-running tasks'],
  ['claude-sonnet-5-5', 'Sonnet 5.5', 'Efficient for routine tasks'],
  ['claude-haiku-5-5', 'Haiku 5.5', 'Fastest for quick answers'],
].map(([id, label, description]) => ({ id, label, description, efforts: [...EFFORTS], auto: true, main: true }));

let models: ModelList = { models: FALLBACK_MODELS, source: 'fallback', defaultId: null };
let modelsAt = 0, modelsLoading: Promise<void> | null = null;

function takeModels(list: ModelInfo[]): void {
  const seen = new Set<string>(), out: ModelChoice[] = [];
  for (const m of list) {
    const id = m.resolvedModel || m.value;
    if (m.value === 'default' || seen.has(id)) continue;   // "Default (recommended)" is the same model as one listed below it
    seen.add(id);
    out.push({
      id, label: m.displayName || id, description: m.description || '',
      efforts: m.supportsEffort ? (m.supportedEffortLevels || [...EFFORTS]).filter(e => EFFORTS.includes(e)) : [],
      auto: m.supportsAutoMode === true,
      main: !m.value.startsWith('claude-'),     // the aliases (opus, fable, sonnet, haiku) are the current models
    });
  }
  const def = list.find(m => m.value === 'default');
  if (out.length) { models = { models: out, source: 'sdk', defaultId: def ? def.resolvedModel || null : null }; modelsAt = Date.now(); }
}

/**
 * The models this PC's Claude Code offers, from the Agent SDK's supportedModels(). Asking needs a
 * Claude Code process, so start one with a prompt that never arrives (no message is sent, no session
 * is written), ask, and close it. Cached for six hours; the fallback list is used until then.
 */
export async function listModels(): Promise<ModelList> {
  if (Date.now() - modelsAt > 6 * 3600e3 && !modelsLoading) {
    modelsLoading = (async () => {
      let release!: () => void;
      const idle = new Promise<void>(r => { release = r; });
      async function* never() { await idle; }
      const q = query({ prompt: never(), options: { cwd: (fs.mkdirSync(SCRATCH, { recursive: true }), SCRATCH), permissionMode: 'default' } });
      try { takeModels(await Promise.race([q.supportedModels(), new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout')), 30e3))])); }
      catch (e) { console.log('claude: model list unavailable:', String((e as Error).message || e).slice(0, 120)); modelsAt = Date.now() - 5.5 * 3600e3; }   // retry in half an hour
      finally { release(); try { q.close(); } catch { /* already gone */ } modelsLoading = null; }
    })();
  }
  if (modelsLoading && models.source === 'fallback') await modelsLoading;
  return models;
}

const findModel = (id: string | null | undefined): ModelChoice | undefined => (id ? models.models.find(m => m.id === id) : undefined);
const safeModel = (m: unknown): string | null => (typeof m === 'string' && /^[a-z0-9][a-z0-9.\-\[\]]{0,63}$/i.test(m) ? m : null);
const safeEffort = (e: unknown): HubEffort | null => (EFFORTS.includes(e as HubEffort) ? e as HubEffort : null);
/** Only the four offered modes get through; anything else (bypassPermissions, dontAsk…) is Manual. */
const safeMode = (m: unknown): HubPermission | null => (MODES.includes(m as HubPermission) ? m as HubPermission : null);

/** Settings asked for in a request body ({model, effort, mode}), cleaned. */
export function settingsFrom(body: Record<string, unknown>): Partial<SessionSettings> {
  const out: Partial<SessionSettings> = {};
  if (body.model !== undefined) out.model = safeModel(body.model);
  if (body.effort !== undefined) out.effort = safeEffort(body.effort);
  if (body.mode !== undefined) out.mode = safeMode(body.mode);
  return out;
}

// the context window, learned from each turn's modelUsage; before that, what Claude's current models have
const windows = new Map<string, number>();
const windowFor = (model: string | null): number => {
  if (!model) return 1_000_000;
  const id = model.replace(/\[1m\]$/i, '');
  return windows.get(model) || windows.get(id)
    || (/\[1m\]$/i.test(model) || /fable|mythos|opus-5|opus-4-[678]|sonnet-5|sonnet-4-6|haiku-5/.test(id) ? 1_000_000 : 200_000);
};

/** What a session's log says it runs with, and how full its context is (from the last reply's usage). */
interface LogState { model: string | null; effort: HubEffort | null; mode: string | null; used: number | null }
const logCache = new Lru<string, { key: string; state: LogState }>(200);
function logState(file: string): LogState {
  const none: LogState = { model: null, effort: null, mode: null, used: null };
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return none; }
  const key = `${st.size}:${st.mtimeMs}`, hit = logCache.get(file);
  if (hit && hit.key === key) return hit.state;
  const start = Math.max(0, st.size - 600_000), buf = Buffer.alloc(st.size - start);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
  const state = { ...none };
  for (const raw of buf.toString('utf8').split('\n')) {
    if (!raw.includes('"permissionMode"') && !raw.includes('"usage"')) continue;
    let o: any;
    try { o = JSON.parse(raw); } catch { continue; }
    if (o.isSidechain) continue;
    if (o.type === 'user' && typeof o.permissionMode === 'string') state.mode = o.permissionMode;
    else if (o.type === 'assistant' && o.message?.usage && o.message.model && o.message.model !== '<synthetic>') {
      const u = o.message.usage;
      state.used = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
      state.model = o.message.model;
      if (safeEffort(o.effort)) state.effort = o.effort;
    }
  }
  logCache.set(file, { key, state });
  return state;
}

/** Modes set from Claude Home since the log was written (e.g. Plan → Manual after you approve a plan). */
const modeNow = new Map<string, HubPermission>();

function settingsOf(id: string): { settings: SessionSettings; context: ContextUse | null } {
  const s = lookupSession(id);
  const log = s ? logState(s.file) : null;
  const model = log?.model || s?.model || null;
  const settings: SessionSettings = { model, effort: log?.effort ?? null, mode: modeNow.get(id) ?? (log?.mode ? safeMode(log.mode) ?? 'default' : null) };
  const context = log?.used != null ? { used: log.used, window: windowFor(model) } : null;
  return { settings, context };
}

/** Resolve what a turn runs with: what was asked, else what the session had, else Claude Code's defaults. */
function resolve(want: Partial<SessionSettings>, had: SessionSettings | null): { model?: string; effort?: HubEffort; mode: PermissionMode } {
  const model = (want.model !== undefined ? want.model : had?.model) || undefined;
  const effort = (want.effort !== undefined ? want.effort : had?.effort) || undefined;
  let mode: HubPermission = (want.mode !== undefined ? want.mode : had?.mode) || 'default';
  if (mode === 'auto' && findModel(model)?.auto === false) mode = 'default';   // that model can't run Auto: ask instead
  const fx = findModel(model);
  return { model, effort: effort && (!fx || fx.efforts.includes(effort)) ? effort : undefined, mode };
}

interface Live extends HubTurn {
  q: Query | null;
  abort: AbortController;
  answer: ((allow: boolean, next?: HubPermission) => void) | null;
  finishedAt: number | null;
  /** A reply sent into a session open on the PC (pclink.ts): the PC process runs it, not the Hub. */
  pc?: boolean;
  /** When the turn last got an event (ms). The stalled line shows in view after STALL_MS with none. */
  lastEventAt?: number;
  /** How long the turn took (ms), from the SDK's result message. */
  durationMs?: number | null;
}
const turns = new Map<string, Live>();
/** Replies on their way to sessions open on the PC, and the PC hooks waiting for them (pclink.ts). */
const inbox = new PcInbox();

/** The last step of a Hub turn: "Finished in 2 min 5 s" when it is done and the SDK gave its time (ms). */
export function finishLine(status: TurnStatus, ms: number | null): string {
  if (status === 'done') return ms == null ? 'Finished' : `Finished in ${durationText(ms)}`;
  return status === 'stopped' ? 'Stopped' : 'Failed';
}

/** The line for a PC turn whose reply has waited this long for the PC hook to pick it up. */
export const PC_PICKUP_TEXT = 'Waiting for your PC to pick it up';
export const PC_PICKUP_MS = 60e3;

/** The steps a turn shows: the latest six, then the stalled line once a running Hub turn has had no event for STALL_MS,
 *  or the PC pick-up line once a reply sent to a PC session has waited PC_PICKUP_MS (`queuedAt`, ms).
 *  The line is added here only; it is not kept as a step. */
export function progressFor(progress: string[], status: TurnStatus, onPc: boolean, lastEventAt: number | undefined, now = Date.now(), queuedAt: number | null = null): string[] {
  const shown = progress.slice(-6);
  if (status !== 'running') return shown;
  if (onPc) return queuedAt != null && now - queuedAt >= PC_PICKUP_MS ? [...shown, PC_PICKUP_TEXT] : shown;
  return stalled(now, lastEventAt ?? null) ? [...shown, STALLED_TEXT] : shown;
}

const view = (t: Live): HubTurn => ({
  id: t.id, sessionId: t.sessionId, title: t.title, status: t.status, startedAt: t.startedAt,
  progress: progressFor(t.progress, t.status, !!t.pc, t.lastEventAt, Date.now(), t.pc ? inbox.queued(t.sessionId) : null),
  approval: t.approval, reply: t.reply, error: t.error,
});
const runningFor = (sessionId: string) => [...turns.values()].find(t => t.sessionId === sessionId && (t.status === 'running' || t.status === 'approval'));
/** Is a reply from the Hub running in this session right now? */
export const hubTurnRunning = (sessionId: string): boolean => !!runningFor(sessionId);

const step = (t: Live, line: string) => { t.progress.push(line); if (t.progress.length > 20) t.progress.shift(); t.lastEventAt = Date.now(); };

/** End a PC turn (the session finished its turn, or closed). */
function endPcTurn(t: Live, status: 'done' | 'error', reply: string | null, error: string | null = null): void {
  if (t.status === 'running' || t.status === 'approval') t.status = status;
  if (reply) t.reply = reply.slice(0, 1500);
  t.error = error; t.finishedAt = Date.now(); t.approval = null; t.answer = null;
  step(t, status === 'done' ? 'Finished on your PC' : 'The session closed on your PC');
  logAction('hub', `turn-pc-${status}`, { session: t.sessionId, turn: t.id });
}

/** A PC turn whose session is no longer open on the PC has ended. */
function settlePcTurns(): void {
  const live = [...turns.values()].filter(t => t.pc && (t.status === 'running' || t.status === 'approval'));
  if (!live.length) return;
  const open = openSessions();
  for (const t of live) if (!open.has(t.sessionId)) { inbox.forget(t.sessionId); endPcTurn(t, 'error', null, 'The session closed on your PC.'); }
}

/** A turn as the pruning sees it. */
export interface KeepTurn { id: string; sessionId: string; status: string; startedAt: string; finishedAt: number | null }

/** The ids to drop from the turn list at `now`. A finished turn goes after keepMs, except the latest turn of a session
 *  when that turn ended in an error: it stays until the session's next turn starts (see launch). */
export function turnsToDrop(list: KeepTurn[], now: number, keepMs: number): string[] {
  const latest = new Map<string, KeepTurn>();
  for (const t of list) {
    if (!t.sessionId) continue;
    const cur = latest.get(t.sessionId);
    if (!cur || t.startedAt.localeCompare(cur.startedAt) > 0) latest.set(t.sessionId, t);
  }
  return list
    .filter(t => t.finishedAt && now - t.finishedAt > keepMs && !(t.status === 'error' && latest.get(t.sessionId) === t))
    .map(t => t.id);
}

export function listTurns(): HubTurn[] {
  settlePcTurns();
  const drop = turnsToDrop([...turns.values()].map(t => ({ id: t.id, sessionId: t.sessionId, status: t.status, startedAt: t.startedAt, finishedAt: t.finishedAt })), Date.now(), KEEP_FINISHED_MS);
  for (const id of drop) turns.delete(id);
  return [...turns.values()].map(view);
}

/** Can the Hub reply to this session right now, and if not, why not. */
export function sessionView(id: string, have = ''): SessionView {
  settlePcTurns();
  const s = lookupSession(id);
  const running = runningFor(id);
  const latest = running || [...turns.values()].filter(t => t.sessionId === id).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  // open on the PC with the PC link's hook listening: the reply goes into that PC session (pclink.ts), not through the SDK
  const viaPc = !!s?.live.open && inbox.listening(id);
  let reason: ReplyBlock | null = null;
  if (!s) reason = 'not_found';
  else if (running) reason = 'running';
  else if (s.live.open && !viaPc) reason = 'open_on_pc';
  else if (s.live.state !== 'waiting') reason = 'busy';
  else if (!viaPc && s.live.age > 30 * 60 && !s.live.hub) reason = 'too_old';   // Hub-started and open PC sessions never go stale here
  else if (!viaPc && runningCount() >= MAX_RUNNING) reason = 'too_many';   // a PC turn runs on the PC, not here
  const { settings, context } = s ? settingsOf(id) : { settings: undefined, context: null };
  const pinned = new Set(pinnedIn(id));
  const transcript = s ? transcriptFor(id).map(e => (e.id && pinned.has(e.id) ? { ...e, pinned: true } : e)) : [];
  // the version covers the log and the pins (a pin changes the entries), so a client with the same version has the same text
  const version = s ? `${id}|${transcriptVersion(id)}|${[...pinned].sort().join(',')}` : '';
  const unchanged = !!have && have === version;
  return {
    session: s?.live ?? null, transcript: unchanged ? [] : transcript, version, unchanged,
    lastText: s?.lastText ?? null, canReply: reason == null, reason, turn: latest ? view(latest) : null, settings, context,
    next: s ? nextStepFor(id) : null,   // sent even when unchanged: the page keeps its old transcript but takes this
  };
}

interface LaunchOptions {
  resume?: string; cwd: string; title: string; text: string; from: string; firstStep: string; voice?: boolean;
  model?: string; effort?: HubEffort; mode: PermissionMode; photos?: LoadedPhoto[];
}

/** Plan mode: the plan Claude wants approved (ExitPlanMode's input, the plan file it names, or its last words). */
function planText(input: Record<string, any>, fallback: string | null): string {
  if (typeof input.plan === 'string' && input.plan.trim()) return input.plan.trim().slice(0, 20000);
  const file = typeof input.planFilePath === 'string' ? input.planFilePath : null;
  if (file && /\.md$/i.test(file)) {
    try { if (fs.statSync(file).size < 200_000) return fs.readFileSync(file, 'utf8').trim().slice(0, 20000); } catch { /* not there */ }
  }
  return fallback || 'Claude has a plan ready (see the conversation).';
}

/**
 * Sessions started by voice on the tablet: the final answer is read aloud there, so ask for a
 * speakable one. Only for new sessions: a session's system prompt is fixed once it starts.
 */
const VOICE_PROMPT = 'This session was started by voice from ClaudeOS, a desk tablet. Your final message in each turn is read aloud '
  + 'by text-to-speech, and the full transcript is also on the screen. End every turn with a short, conversational answer '
  + '(one to three sentences, plain words, no Markdown, code, tables, lists, file paths or URLs in that final message); '
  + 'if there is more detail, say it is on the screen. Work as usual otherwise.';

/** Run one turn through the Agent SDK: resume a session, or start a new one when `resume` is absent. */
function launch(o: LaunchOptions): { turn: Live; sessionId: Promise<string> } {
  // a new session's system prompt: the voice rules (for a voice session), what Settings → Profile says about the user,
  // and the user's instructions from Settings → Your Claude.
  // Set once, when the session starts: a resumed session keeps the prompt it began with.
  const append = o.resume ? '' : [o.voice ? VOICE_PROMPT : '', profileForPrompt(), instructionsForPrompt()].filter(Boolean).join('\n\n');
  const t: Live = {
    id: crypto.randomUUID(), sessionId: o.resume || '', title: o.title, status: 'running', startedAt: new Date().toISOString(),
    progress: [o.firstStep], approval: null, reply: null, error: null,
    q: null, abort: new AbortController(), answer: null, finishedAt: null, lastEventAt: Date.now(),
  };
  turns.set(t.id, t);
  // a session's next turn replaces its kept error turn (turnsToDrop keeps that one until now)
  if (o.resume) for (const [id, old] of turns) if (id !== t.id && old.sessionId === o.resume && old.status === 'error') turns.delete(id);
  let gotId!: (id: string) => void;
  const sessionId = new Promise<string>(resolve => { gotId = resolve; });
  if (o.resume) gotId(o.resume);
  let endInput!: () => void;
  const inputHeld = new Promise<void>(resolve => { endInput = resolve; });

  const pluginOpts = turnPluginOptions(o.cwd);
  const q = query({
    prompt: promptFor(o.text, o.photos || [], inputHeld),
    options: {
      resume: o.resume,
      cwd: o.cwd,
      model: o.model,
      effort: o.effort,
      // Auto / Manual ('default') / Accept edits / Plan, as picked on the tablet. Never 'bypassPermissions':
      // the folder's own rules always apply, and anything they don't settle comes to canUseTool below.
      permissionMode: o.mode === 'bypassPermissions' ? 'default' : o.mode,
      // Plugins (Settings → Plugins): the user's own MCP servers, skills, plugins and connectors load as Claude Code
      // loads them, with ClaudeOS's switch-offs and its own servers applied on top. MCP tools go through canUseTool
      // like any other tool: nothing here allows them.
      ...pluginOpts,
      // Claude control: the browser tools on the tablet (server/browser.ts) join the user's own servers. Each call is a
      // tool call, so it goes through canUseTool like the rest: an approval card on the tablet first.
      // The Home Assistant tools (home-assistant/server/tools.ts) and the tablet tools (timers, alarms, reminders,
      // notices: server/tablet.ts), the family lists (lists/server/tools.ts) and the read-only calendar
      // (calendar/server/tools.ts) join the same way, under the same approvals.
      mcpServers: { ...(pluginOpts.mcpServers ?? {}), claudeos_browser: browserServer, claudeos_ha: haServer, claudeos_tablet: tabletServer, claudeos_lists: listsServer, claudeos_calendar: calendarServer, claudeos_weather: weatherServer, claudeos_routines: routinesServer },
      abortController: t.abort,
      // the PC link's hooks (scripts/claude-os-pc-hook.ts) load with the user's settings: this tells them the Hub runs this turn
      env: { ...process.env, CLAUDEOS_HUB_TURN: '1' },
      ...(append ? { systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, append } } : {}),
      canUseTool: (tool, input, { signal }) => new Promise(resolve => {
        const isPlan = tool === 'ExitPlanMode';
        const { summary, detail } = isPlan
          ? { summary: 'Start making changes', detail: 'Claude has finished planning.' }
          : askFor(tool, input as Record<string, any>);
        const approval: Approval = { id: crypto.randomUUID(), tool, summary, detail, expiresAt: new Date(Date.now() + APPROVAL_MS).toISOString(),
          ...(isPlan ? { kind: 'plan' as const, plan: planText(input as Record<string, any>, t.reply) } : {}) };
        t.approval = approval; t.status = 'approval';
        step(t, isPlan ? 'Plan ready for your OK' : `Asking: ${summary}`);
        const finish = (allow: boolean, why: string, next?: HubPermission) => {
          clearTimeout(timer); signal.removeEventListener('abort', onAbort);
          t.answer = null; t.approval = null;
          if (t.status === 'approval') t.status = 'running';
          if (isPlan) {
            step(t, allow ? `Plan approved: ${next === 'acceptEdits' ? 'accepting edits' : next === 'auto' ? 'Auto mode' : 'asking before changes'}` : `Kept planning${why ? ` (${why})` : ''}`);
            if (allow && next && t.sessionId) modeNow.set(t.sessionId, next);
            resolve(allow
              ? { behavior: 'allow', updatedInput: input, updatedPermissions: [{ type: 'setMode', mode: next || 'default', destination: 'session' }] }
              : { behavior: 'deny', message: why === 'timed out' ? 'Nobody answered on ClaudeOS in time. Stay in plan mode.'
                : why === 'stopped' ? 'Stopped from ClaudeOS.' : 'Not yet: the user wants to keep planning. Stay in plan mode and ask what to change.' });
            return;
          }
          step(t, `${allow ? 'Allowed' : 'Denied'}: ${summary}${why ? ` (${why})` : ''}`);
          resolve(allow
            ? { behavior: 'allow', updatedInput: input }
            : { behavior: 'deny', message: why === 'timed out' ? 'Nobody answered on ClaudeOS in time, so this was denied.' : 'Denied from ClaudeOS.' });
        };
        const timer = setTimeout(() => { logAction('hub', 'approval-timeout', { session: t.sessionId, turn: t.id, tool, detail }); finish(false, 'timed out'); }, APPROVAL_MS);
        const onAbort = () => finish(false, 'stopped');
        signal.addEventListener('abort', onAbort, { once: true });
        t.answer = (allow, next) => finish(allow, '', next);
      }),
    },
  });
  t.q = q;
  if (Date.now() - modelsAt > 3600e3) q.supportedModels().then(takeModels, () => { /* keep the list we have */ });

  void (async () => {
    let failReason: string | null = null;   // the assistant error code, when the SDK sent one (failed.ts)
    try {
      for await (const m of q) {
        t.lastEventAt = Date.now();   // every SDK message counts as an event, so the stalled line only shows after real silence
        if (!t.sessionId && 'session_id' in m && m.session_id) { t.sessionId = m.session_id; gotId(m.session_id); }
        // the mode can change mid-turn (e.g. leaving Plan mode): remember it for the next reply
        if (m.type === 'system' && 'permissionMode' in m && t.sessionId) {
          const pm = safeMode((m as { permissionMode?: string }).permissionMode);
          if (pm) modeNow.set(t.sessionId, pm);
        }
        if (m.type === 'result') for (const [id, u] of Object.entries(m.modelUsage || {})) if (u.contextWindow > 0) windows.set(id, u.contextWindow);
        // a retry or compacting: the same progress wording as the tablet chat (native-stream.ts)
        if (m.type === 'system') {
          const s = m as { subtype?: string; attempt?: number; max_retries?: number; status?: string | null; error_status?: number | null };
          if (s.subtype === 'api_retry') step(t, retryText(Number(s.attempt) || 0, Number(s.max_retries) || 0, s.error_status));
          else if (s.subtype === 'status' && s.status === 'compacting') step(t, COMPACTING_TEXT);
        }
        if (m.type === 'assistant') {
          failReason = (m as { error?: string }).error || failReason;
          for (const b of m.message.content) {
            if (b.type === 'tool_use') step(t, describeTool(b.name, b.input as Record<string, any>).summary);
            else if (b.type === 'text' && b.text.trim()) t.reply = b.text.trim().slice(0, 1500);
          }
        } else if (m.type === 'result') {
          t.durationMs = typeof m.duration_ms === 'number' ? m.duration_ms : null;
          if (m.subtype === 'success') { t.reply = String(m.result || t.reply || '').slice(0, 1500); if (t.status !== 'stopped') t.status = 'done'; }
          else if (t.status !== 'stopped') { t.status = 'error'; t.error = failedSentence(failReason || m.subtype); console.log('turn ended:', m.subtype, failReason); }
        }
      }
      if (t.status === 'running') t.status = 'done';
    } catch (e) {
      if (t.status !== 'stopped') { t.status = 'error'; t.error = failedSentence(failReason); console.log('turn failed:', e); }
    } finally {
      t.finishedAt = Date.now(); t.approval = null; t.answer = null; t.q = null;
      endInput();
      if (!t.sessionId) gotId('');
      step(t, finishLine(t.status, t.durationMs ?? null));
      logAction('hub', `turn-${t.status}`, { session: t.sessionId, turn: t.id });
    }
  })();
  return { turn: t, sessionId };
}

const runningCount = () => [...turns.values()].filter(t => !t.pc && (t.status === 'running' || t.status === 'approval')).length;

/** Reply to a session. `want`: model / effort / mode picked on the tablet (missing ones: what the session had). `photoIds`: photos to send with it. */
export function startTurn(sessionId: string, text: string, from: string, want: Partial<SessionSettings> = {}, photoIds: string[] = []): { ok: boolean; error?: string; turn?: HubTurn } {
  const v = sessionView(sessionId);
  if (!v.canReply) return { ok: false, error: v.reason || 'blocked' };
  const s = lookupSession(sessionId)!;
  if (s.live.open) return sendToPc(sessionId, s.live.title, text, from, photoIds);
  const loaded = loadPhotos(photoIds);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const message = String(text || '').trim().slice(0, 2000) || (loaded.photos.length ? PHOTO_QUESTION : '');
  if (!message) return { ok: false, error: 'empty' };
  const run = resolve(want, v.settings || null);
  const { turn } = launch({ resume: sessionId, cwd: s.cwd, title: s.live.title, text: message, from, firstStep: 'Sending your reply', photos: loaded.photos, ...run });
  modeNow.set(sessionId, run.mode as HubPermission);
  logAction(from, 'reply', { session: sessionId, turn: turn.id, text: message, photos: loaded.photos.length, model: run.model || 'default', effort: run.effort || 'default', mode: run.mode });
  return { ok: true, turn: view(turn) };
}

// ---------- sessions open on the PC (the PC link, pclink.ts) ----------
// The reply is handed to the session's Stop hook, which wakes that same PC session with it. The PC process runs the
// turn; the tablet follows it through the session log, and its permission prompts come here through the
// PermissionRequest hook (pcPermission). Model, effort and mode stay as the PC session has them; photos can't go.

function sendToPc(sessionId: string, title: string, text: string, from: string, photoIds: string[]): { ok: boolean; error?: string; turn?: HubTurn } {
  if (photoIds.length) return { ok: false, error: 'photos_on_pc' };
  const message = String(text || '').trim().slice(0, 2000);
  if (!message) return { ok: false, error: 'empty' };
  const t: Live = {
    id: crypto.randomUUID(), sessionId, title, status: 'running', startedAt: new Date().toISOString(),
    progress: ['Sent to your PC session'], approval: null, reply: null, error: null,
    q: null, abort: new AbortController(), answer: null, finishedAt: null, pc: true,
  };
  if (!inbox.deliver(sessionId, rewakeText(message))) return { ok: false, error: 'open_on_pc' };
  turns.set(t.id, t);
  logAction(from, 'reply-pc', { session: sessionId, turn: t.id, text: message });
  return { ok: true, turn: view(t) };
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One long poll from a PC session's Stop hook (scripts/claude-os-pc-hook.ts). `fresh`: the first poll after a turn ended on
 * the PC, so a PC turn sent from here is done (`lastText`: Claude's last words in it).
 */
export async function pcWait(body: Record<string, unknown>, signal: AbortSignal): Promise<{ ok: boolean; error?: string; answer?: WaitAnswer }> {
  const session = String(body.session || ''), waiter = String(body.waiter || '');
  if (!SESSION_ID.test(session) || !/^[\w-]{8,64}$/.test(waiter)) return { ok: false, error: 'bad_request' };
  const fresh = body.fresh === true;
  if (fresh) {
    const t = runningFor(session);
    if (t?.pc) endPcTurn(t, 'done', typeof body.lastText === 'string' ? body.lastText : null);
  } else if (!openSessions().has(session)) {
    inbox.forget(session);   // the PC session closed: its hook can stop
    return { ok: true, answer: { kind: 'stop' } };
  }
  return { ok: true, answer: await inbox.wait(session, waiter, fresh, 25e3, signal) };
}

/**
 * A permission prompt from a PC session (the PermissionRequest hook). Only while a reply sent from here is running in
 * that session: the tablet answers it. Otherwise, or with no answer in 3 minutes, no decision: the PC asks as usual.
 */
export function pcPermission(body: Record<string, unknown>, signal: AbortSignal): Promise<{ ok: boolean; error?: string; decision?: PcDecision | null }> {
  const session = String(body.session || ''), tool = String(body.tool || '').slice(0, 200);
  if (!SESSION_ID.test(session) || !tool) return Promise.resolve({ ok: false, error: 'bad_request' });
  settlePcTurns();
  const t = runningFor(session);
  if (!t?.pc || t.approval) return Promise.resolve({ ok: true, decision: null });
  const input = (body.input && typeof body.input === 'object' ? body.input : {}) as Record<string, any>;
  return new Promise(resolve => {
    const isPlan = tool === 'ExitPlanMode';
    const { summary, detail } = isPlan ? { summary: 'Start making changes', detail: 'Claude has finished planning.' } : askFor(tool, input);
    t.approval = { id: crypto.randomUUID(), tool, summary, detail, expiresAt: new Date(Date.now() + APPROVAL_MS).toISOString(),
      ...(isPlan ? { kind: 'plan' as const, plan: planText(input, t.reply) } : {}) };
    t.status = 'approval';
    step(t, isPlan ? 'Plan ready for your OK' : `Asking: ${summary}`);
    const finish = (decision: PcDecision | null, line: string) => {
      clearTimeout(timer); signal.removeEventListener('abort', onAbort);
      t.answer = null; t.approval = null;
      if (t.status === 'approval') t.status = 'running';
      step(t, line);
      resolve({ ok: true, decision });
    };
    const timer = setTimeout(() => {
      logAction('hub', 'approval-timeout', { session, turn: t.id, tool, detail });
      finish(null, 'No answer here: the PC asks instead');
    }, APPROVAL_MS);
    const onAbort = () => finish(null, 'Answered on the PC');
    signal.addEventListener('abort', onAbort, { once: true });
    t.answer = (allow, next) => {
      if (t.status === 'stopped') return finish({ behavior: 'deny', message: 'Stopped from ClaudeOS.', interrupt: true }, 'Stopped');
      if (!allow) {
        return finish({ behavior: 'deny', message: isPlan ? 'Not yet: the user wants to keep planning. Stay in plan mode and ask what to change.' : 'Denied from ClaudeOS.' },
          isPlan ? 'Kept planning' : `Denied: ${summary}`);
      }
      finish(isPlan ? { behavior: 'allow', updatedPermissions: [{ type: 'setMode', mode: next || 'default', destination: 'session' }] } : { behavior: 'allow' },
        isPlan ? 'Plan approved' : `Allowed: ${summary}`);
    };
  });
}

/** Start a brand-new session from the Hub in one of the listed folders (with photos, if any). */
export async function startNew(projectId: string, text: string, from: string, voice = false, want: Partial<SessionSettings> = {}, photoIds: string[] = []): Promise<NewSessionResult> {
  const cwd = projectFolder(String(projectId || ''));
  if (!cwd) return { ok: false, error: 'no_such_folder' };
  const loaded = loadPhotos(photoIds);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const message = String(text || '').trim().slice(0, 2000) || (loaded.photos.length ? PHOTO_QUESTION : '');
  if (!message) return { ok: false, error: 'empty' };
  if (runningCount() >= MAX_RUNNING) return { ok: false, error: 'too_many' };
  const title = message.length > 60 ? message.slice(0, 59) + '…' : message;
  const run = resolve(want, null);
  const { turn, sessionId } = launch({ cwd, title, text: message, from, firstStep: 'Starting a new session', voice, photos: loaded.photos, ...run });
  logAction(from, voice ? 'new-session-voice' : 'new-session', { turn: turn.id, folder: cwd, text: message, photos: loaded.photos.length, model: run.model || 'default', effort: run.effort || 'default', mode: run.mode });
  // remember the session when its id arrives, even after the 45 s wait below, so a slow start is not lost
  const remember = (id: string) => {
    if (!id) return;
    if (!modeNow.has(id)) modeNow.set(id, run.mode as HubPermission);
    rememberHubSession({ id, cwd, title, createdAt: new Date().toISOString() });
  };
  sessionId.then(remember);
  const id = await Promise.race([sessionId, new Promise<string>(r => setTimeout(() => r(''), 45e3))]);
  if (!id) return { ok: false, error: turn.error || 'did_not_start' };
  return { ok: true, sessionId: id };
}

/** Allow or deny. For a plan (Plan mode), `next` is the mode to carry on in: Manual (default), Accept edits or Auto. */
export function answerApproval(turnId: string, approvalId: string, allow: boolean, from: string, next?: unknown): { ok: boolean; error?: string } {
  const t = turns.get(turnId);
  if (!t || !t.approval || t.approval.id !== approvalId || !t.answer) return { ok: false, error: 'no_such_approval' };
  const mode = t.approval.kind === 'plan' ? safeMode(next) : null;
  logAction(from, allow ? 'approve' : 'deny', { session: t.sessionId, turn: t.id, tool: t.approval.tool, detail: t.approval.detail, ...(mode ? { then: mode } : {}) });
  t.answer(allow, mode && mode !== 'plan' ? mode : 'default');
  return { ok: true };
}

export async function stopTurn(turnId: string, from: string): Promise<{ ok: boolean; error?: string }> {
  const t = turns.get(turnId);
  if (!t || !(t.status === 'running' || t.status === 'approval')) return { ok: false, error: 'not_running' };
  logAction(from, 'stop', { session: t.sessionId, turn: t.id });
  t.status = 'stopped';
  t.answer?.(false);
  if (t.pc) {
    // the PC process runs it: a waiting permission prompt is denied with an interrupt (above); otherwise the tablet stops following it
    t.finishedAt = Date.now(); t.approval = null; t.answer = null;
    step(t, 'Stopped following here');
    return { ok: true };
  }
  try { await t.q?.interrupt(); } catch { /* fall through to abort */ }
  setTimeout(() => t.abort.abort(), 5e3);   // if it hasn't wound down by then, end it
  return { ok: true };
}
