// Shapes of what the Claude app's server routes send to its page. Imported by both sides.

export type LimitStatus = 'ok' | 'no_token' | 'expired' | 'error';

export interface LimitWindow {
  used: number | null;          // percent of the window used
  resets_at: string | null;     // ISO time
}

export interface LimitEntry {
  kind: string;                 // session | weekly_all | weekly_scoped | …
  group: string;
  percent: number;
  severity: string;
  resets_at: string | null;
  model: string | null;         // for model-scoped weekly limits, e.g. "Fable"
  active: boolean;
}

export interface Limits {
  status: LimitStatus;
  error: string | null;
  updated: string | null;
  source: string | null;        // env | file | claude
  limits: Record<string, LimitWindow>;   // five_hour, seven_day, …
  list: LimitEntry[];
  breakdown: { name: string; percent: number; of_limit: number }[];
}

export type SessionState = 'thinking' | 'tool' | 'waiting' | 'stalled';

export interface LiveSession {
  id: string | null;
  title: string;
  folder: string;
  branch: string | null;
  model: string | null;
  state: SessionState;
  tool: string | null;
  age: number;                  // seconds since the last entry
  subagents: number;
  working: number;              // subagents running right now, from the session log
  tokens: number;               // today, this session
  surface: string | null;       // cli | claude-desktop | sdk …
  open: boolean;                // open in a Claude Code window on the PC right now
  hub: boolean;                 // started from the Hub (always listed, always answerable here)
  folderId?: string;            // the project folder's id (same as HistoryGroup.id), for grouping
}

// ---------- every past session on the PC (the Sessions screen's sidebar) ----------
export interface HistoryItem {
  id: string;
  title: string;
  at: string;                   // last activity (ISO)
  messages: number;             // your messages + Claude's replies
  open: boolean;                // open in a Claude Code window on the PC right now
  live: boolean;                // written to in the last 30 minutes
  hub: boolean;                 // started from Claude Home
}

/** One project folder's sessions, newest first. The full path stays on the PC. */
export interface HistoryGroup {
  id: string;
  name: string;
  count: number;                // sessions in this folder (matching the search, if any)
  latest: string;               // ISO
  items: HistoryItem[];
  more: boolean;                // older ones not sent yet: ask again with folder=<id>&before=<last at>
}

export interface History { q: string; total: number; groups: HistoryGroup[]; archived: number }   // archived: how many are archived (all of them, whatever the search)

/** A folder a new session can start in. The full path stays on the PC. */
export interface Project { id: string; name: string; detail: string; lastUsed: string }
export interface NewSessionResult { ok: boolean; sessionId?: string; error?: string }

// ---------- replying from the Hub ----------
export type TurnStatus = 'running' | 'approval' | 'done' | 'error' | 'stopped';

export interface Approval {
  id: string;
  tool: string;                 // e.g. Write, Bash
  summary: string;              // one line: "Write notes.txt"
  detail: string;               // the command or path, shown in full
  expiresAt: string;            // auto-denied after this
  kind?: 'tool' | 'plan';       // plan: Claude (in Plan mode) asks to stop planning and start making changes
  plan?: string;                // plan approvals: the plan, Markdown
}

// ---------- session controls (model, effort, permission mode, context) ----------
/** Permission modes Claude Home offers. Never 'bypassPermissions': permission checks are never bypassed from here. */
export type HubPermission = 'auto' | 'default' | 'acceptEdits' | 'plan';
export type HubEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/** A session's model / effort / mode; null means "the default". */
export interface SessionSettings { model: string | null; effort: HubEffort | null; mode: HubPermission | null }
export interface ModelChoice {
  id: string;                   // full model id, e.g. claude-opus-5-5
  label: string;                // "Opus 5.5"
  description: string;
  efforts: HubEffort[];         // empty: no effort setting for this model
  auto: boolean;                // supports Auto mode
  main: boolean;                // in the first list (the rest go under "More models")
}
export interface ModelList { models: ModelChoice[]; source: 'sdk' | 'fallback'; defaultId: string | null }   // defaultId: what "default" runs
/** How full the context window is, from the latest turn's usage. */
export interface ContextUse { used: number; window: number }

export interface HubTurn {
  id: string;
  sessionId: string;
  title: string;
  status: TurnStatus;
  startedAt: string;
  progress: string[];           // latest steps, newest last
  approval: Approval | null;
  reply: string | null;         // Claude's final words for this turn
  error: string | null;
}

export type ReplyBlock = 'no_pin' | 'not_found' | 'too_old' | 'open_on_pc' | 'busy' | 'running' | 'too_many';

export interface TranscriptEntry {
  kind: 'user' | 'assistant' | 'tool' | 'note';
  text: string;                 // Markdown for assistant, plain for the rest
  tool?: string;                // tool entries: the tool's name
  detail?: string;              // tool entries: the command or path
  at: string | null;
  images?: string[];            // user entries: the photos sent with the message (served URLs, read from the log)
  id?: string;                  // the message's id in the log (for pins and forks); assistant blocks after the first get "#n"
  pinned?: boolean;             // pinned in Claude Home
}

/** The choices Claude offered at the end of its last turn (its wrap_up call): ask, plus [label, what gets sent]. */
export interface NextStep { ask: string | null; choices: [string, string][] }

export interface SessionView {
  session: LiveSession | null;
  transcript: TranscriptEntry[];   // the latest part of the conversation, oldest first
  version?: string;                // a key for this transcript and its pins; send it back as `have` to skip unchanged text
  unchanged?: boolean;             // true: the transcript did not change since `have`, so `transcript` is empty
  lastText: string | null;
  canReply: boolean;
  reason: ReplyBlock | null;
  turn: HubTurn | null;
  settings?: SessionSettings;      // what the session runs with (from its log, or as last set from Claude Home)
  context?: ContextUse | null;
  next?: NextStep | null;          // the latest wrap_up's choices, only when no user message came after it
}

export interface UnlockResult { ok: boolean; token?: string; ttl?: number; error?: string; retryIn?: number }

export interface Today {
  input: number; output: number; cache_read: number; cache_write: number;
  messages: number; total: number;
}

export interface Usage {
  now: string;
  plan: string | null;
  limits: Limits;
  today: Today;
  models: [string, number][];
  projects: [string, number][];
  block: { start: string; end: string; tokens: number; output: number; messages: number } | null;
  peak_block: number;
  burn_per_min: number;
  hourly: number[];
  hourly_start: string;
  active_sessions: number;
  sessions: LiveSession[];
  turns: HubTurn[];             // replies sent from the Hub that are running or just finished
  last_activity: string | null;
}
