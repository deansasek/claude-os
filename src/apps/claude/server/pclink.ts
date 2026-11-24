// The PC link: how a reply or an approval typed on the tablet reaches a Claude Code session that is open on the PC
// (the CLI or the desktop app). Pure parts only, shared by the hub (turns.ts) and the hook script (scripts/claude-os-pc-hook.ts).
//
// Two Claude Code hooks carry it (scripts/claude-os-pc-hook.ts installs them in ~/.claude/settings.json):
//   Stop (asyncRewake)   runs in the background after each turn and long-polls the hub. When the tablet sends a
//                        reply, the hook posts it into that same session as a user message (scripts/session-relay.ts).
//                        If that fails, it prints it to stderr and exits 2, which wakes the session with it as a note.
//   PermissionRequest    while the tablet drives the session, asks the hub first; the tablet's answer is the
//                        decision. No answer in time: no decision, so the PC shows its own prompt as usual.
// Nothing here imports the hub, so the hook script can load it without starting anything.

/** Marks the hook commands this file installs, so they can be found and replaced. */
export const HOOK_MARK = 'claude-os-pc-hook.ts';
/** How long the background Stop hook may live (seconds). It also ends when the hub says the session closed. */
export const STOP_HOOK_TIMEOUT_S = 24 * 3600;
/** How long the PermissionRequest hook may wait (seconds): longer than the hub's 3-minute approval window. */
export const PERMISSION_HOOK_TIMEOUT_S = 200;

/** What one long poll from a session's Stop hook gets back. */
export type WaitAnswer = { kind: 'reply'; text: string } | { kind: 'again' } | { kind: 'stop' };

/**
 * Replies waiting for a PC session, and the Stop hooks listening for them. Only the newest listener of a session
 * counts: an older one (from an earlier turn) is told to stop.
 */
export class PcInbox {
  private latest = new Map<string, { waiter: string; seen: number }>();
  private pending = new Map<string, string>();
  private queuedAt = new Map<string, number>();   // when each pending reply was queued (ms)
  private wake = new Map<string, (a: WaitAnswer) => void>();
  private readonly staleMs: number;
  private readonly now: () => number;
  constructor(staleMs = 45e3, now: () => number = Date.now) { this.staleMs = staleMs; this.now = now; }

  /** Is a Stop hook listening for this session (it polled in the last staleMs)? */
  listening(session: string): boolean {
    const l = this.latest.get(session);
    return !!l && this.now() - l.seen < this.staleMs;
  }

  /** Queue a reply for a session. False when no hook listens, so nothing would carry it. */
  deliver(session: string, text: string): boolean {
    if (!this.listening(session)) return false;
    const w = this.wake.get(session);
    if (w) { this.wake.delete(session); w({ kind: 'reply', text }); }
    else { this.pending.set(session, text); this.queuedAt.set(session, this.now()); }
    return true;
  }

  /** When a reply for a session is still waiting for the PC hook to pick it up (ms), or null when none waits. */
  queued(session: string): number | null {
    return this.pending.has(session) ? this.queuedAt.get(session) ?? null : null;
  }

  /** Drop what a session has (the PC session closed). */
  forget(session: string): void {
    this.latest.delete(session); this.pending.delete(session); this.queuedAt.delete(session);
    const w = this.wake.get(session);
    if (w) { this.wake.delete(session); w({ kind: 'stop' }); }
  }

  /**
   * One long poll from a Stop hook: a reply as soon as there is one, 'again' after waitMs, 'stop' if a newer hook
   * took over. `fresh` is true for the first poll of a hook (a new turn ended), which replaces any older hook.
   */
  wait(session: string, waiter: string, fresh: boolean, waitMs: number, signal?: AbortSignal): Promise<WaitAnswer> {
    const cur = this.latest.get(session);
    if (cur && cur.waiter !== waiter) {
      if (!fresh) return Promise.resolve({ kind: 'stop' });   // an older hook: a newer one took over
      // a new turn ended on the PC: its hook replaces the one still waiting from before
      const old = this.wake.get(session);
      if (old) { this.wake.delete(session); old({ kind: 'stop' }); }
    }
    this.latest.set(session, { waiter, seen: this.now() });
    const queued = this.pending.get(session);
    if (queued !== undefined) { this.pending.delete(session); this.queuedAt.delete(session); return Promise.resolve({ kind: 'reply', text: queued }); }
    return new Promise(resolve => {
      const done = (a: WaitAnswer) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(a); };
      const timer = setTimeout(() => { if (this.wake.get(session) === done) this.wake.delete(session); done({ kind: 'again' }); }, waitMs);
      const onAbort = () => { if (this.wake.get(session) === done) this.wake.delete(session); done({ kind: 'again' }); };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.wake.set(session, done);
    });
  }
}

/** What the woken session reads (the hook's stderr, shown to Claude as Stop hook feedback). */
export function rewakeText(text: string): string {
  return `The user replied from the ClaudeOS tablet. Treat this as their next message and answer it:\n\n${text}`;
}

/** The tablet's reply inside a stored hook note: the text after "answer it:", without the wrapper tags.
 *  '' for a hook note with no reply in it; null when the text is not a tablet reply at all. */
export function tabletReplyIn(text: string): string | null {
  if (!/replied from the ClaudeOS tablet/.test(text)) return null;
  const after = text.split(/answer it:\s*/)[1];
  if (after === undefined) return '';
  return after.replace(/\s*(?:&lt;|<)\/?(?:system-reminder|task-notification)[^]*$/i, '').trim();
}

/** The tablet's answer to a PC permission prompt (the PermissionRequest hook's decision). */
export type PcDecision =
  | { behavior: 'allow'; updatedPermissions?: { type: 'setMode'; mode: string; destination: 'session' }[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean };

/** The PermissionRequest hook's stdout for the tablet's answer. null or anything malformed: print nothing, so the PC asks as usual. */
export function permissionOutput(decision: unknown): string {
  const d = decision as PcDecision | null;
  if (!d || (d.behavior !== 'allow' && d.behavior !== 'deny')) return '';
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: d } });
}

type HookEntry = { matcher?: string; hooks: { type: string; command?: string; [k: string]: unknown }[] };
type Settings = Record<string, any>;

const ours = (e: HookEntry) => Array.isArray(e?.hooks) && e.hooks.some(h => typeof h?.command === 'string' && h.command.includes(HOOK_MARK));

/** Settings without this file's hooks (everything else is kept as it was). */
export function withoutBridgeHooks(settings: Settings): Settings {
  const out: Settings = { ...settings };
  if (!out.hooks || typeof out.hooks !== 'object') return out;
  const hooks: Record<string, HookEntry[]> = { ...out.hooks };
  for (const ev of ['Stop', 'PermissionRequest']) {
    if (!Array.isArray(hooks[ev])) continue;
    const kept = hooks[ev].filter(e => !ours(e));
    if (kept.length) hooks[ev] = kept; else delete hooks[ev];
  }
  out.hooks = hooks;
  if (!Object.keys(hooks).length) delete out.hooks;
  return out;
}

/** Settings with this file's two hooks, run as `<command> stop` and `<command> permission`. Safe to run again. */
export function withBridgeHooks(settings: Settings, command: string): Settings {
  const out = withoutBridgeHooks(settings);
  const hooks: Record<string, HookEntry[]> = { ...(out.hooks || {}) };
  hooks.Stop = [...(hooks.Stop || []), { hooks: [{ type: 'command', command: `${command} stop`, asyncRewake: true, timeout: STOP_HOOK_TIMEOUT_S }] }];
  hooks.PermissionRequest = [...(hooks.PermissionRequest || []), { matcher: '*', hooks: [{ type: 'command', command: `${command} permission`, timeout: PERMISSION_HOOK_TIMEOUT_S }] }];
  out.hooks = hooks;
  return out;
}
