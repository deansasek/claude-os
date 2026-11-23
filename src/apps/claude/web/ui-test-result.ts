// TEST ONLY (the tablet app's ui_test launch, see ui-test.ts): turns what the native chat check saw into the result
// it sends to the PC log. Pure, so it runs in node (test/ui-test-result.test.ts). The message and the reply never go
// into the result: only the reply's length and its first 20 characters, to check it is a real reply.

/** What the check read off the page at one point (after the reply, or after the reload). */
export interface UiProbe {
  replyText: string | null;     // the chat's last reply; null when there is none
  sidebarHtml: string;          // the Sessions sidebar as drawn
  ringLabel: string | null;     // the context ring's label when the ring shows; null when it is hidden
  tokens: number;               // the session's token total
  model: string | null;         // the chat's model as the Sessions screen names it
  messagesShown: number;        // messages drawn in the conversation
  error: string | null;         // the chat's error line, if any
}

/** One probe as the result says it. */
export interface ProbeResult {
  replyLength: number; replyStart: string; listed: boolean; tabletFolder: boolean;
  tokenLine: boolean; tokens: number; model: string | null; messagesShown: number; error: string | null;
}

export const REPLY_START = 20;
const TABLET_FOLDER = 'data-folder="On this tablet"';
const NATIVE_ROW = 'data-id="native"';

export function probeResult(p: UiProbe): ProbeResult {
  const reply = p.replyText || '';
  return {
    replyLength: reply.length, replyStart: reply.slice(0, REPLY_START),
    listed: p.sidebarHtml.includes(TABLET_FOLDER) && p.sidebarHtml.includes(NATIVE_ROW), tabletFolder: p.sidebarHtml.includes(TABLET_FOLDER),
    tokenLine: !!p.ringLabel && /context used/.test(p.ringLabel), tokens: p.tokens,
    model: p.model, messagesShown: p.messagesShown, error: p.error,
  };
}

/** The whole run: ok when a reply came, the chat was listed with its token line, and after the reload it was still
 *  listed with its messages shown (your message and the reply). */
export interface UiTestResult {
  test: 'native-chat'; run: string; ok: boolean; nativeOn: boolean; waitedMs: number;
  replied: boolean; afterReply: ProbeResult; afterReload: ProbeResult | null; failed: string[];
}

export function buildResult(o: { run: string; nativeOn: boolean; waitedMs: number; afterReply: UiProbe; afterReload: UiProbe | null }): UiTestResult {
  const a = probeResult(o.afterReply), b = o.afterReload ? probeResult(o.afterReload) : null;
  const failed: string[] = [];
  if (!a.replyLength) failed.push('no reply');
  if (!a.listed) failed.push('not listed after reply');
  if (!a.tokenLine) failed.push('no token line');
  if (!a.model) failed.push('no model');
  if (!b) failed.push('no reload result');
  else {
    if (!b.listed) failed.push('not listed after reload');
    if (b.messagesShown < 2) failed.push('messages missing after reload');
  }
  return { test: 'native-chat', run: o.run, ok: failed.length === 0, nativeOn: o.nativeOn, waitedMs: o.waitedMs, replied: a.replyLength > 0,
    afterReply: a, afterReload: b, failed };
}

/** The text the PC log gets: every line starts with "uitest:". */
export function logText(r: UiTestResult): string {
  return `uitest: ${r.test} run=${r.run} ${r.ok ? 'PASS' : `FAIL (${r.failed.join(', ')})`}\nuitest: ${JSON.stringify(r)}`;
}

// ---------- phase 2: after the app was closed and opened again (--ez ui_test_phase2 true) ----------

/** What phase 1 leaves in the app's files folder once its own checks pass: its run, when, the app process it ran in,
 *  and the chat's CLI session id (to tell it is the same chat). */
export interface Phase1Marker { v: 1; run: string; ok: true; at: number; process: string | null; sessionId: string | null }

export const markerText = (m: Omit<Phase1Marker, 'v' | 'ok'>): string => JSON.stringify({ v: 1, ok: true, ...m });

/** The marker from the file's text; null when there is none, it is unreadable, or phase 1 did not pass. */
export function readMarker(s: string | null): Phase1Marker | null {
  try {
    const o = s ? JSON.parse(s) as Record<string, unknown> | null : null;
    if (!o || o.v !== 1 || o.ok !== true || typeof o.run !== 'string' || typeof o.at !== 'number') return null;
    return { v: 1, run: o.run, ok: true, at: o.at,
      process: typeof o.process === 'string' ? o.process : null, sessionId: typeof o.sessionId === 'string' ? o.sessionId : null };
  } catch { return null; }
}

/** Whether the app was really restarted between phase 1 and phase 2.
 *  process: the app process ids differ (unknown when either is missing, an older app build).
 *  freshPage: this page loaded after phase 1 ended, and the tab's sessionStorage from phase 1 is gone (a new WebView). */
export interface Restart { process: 'yes' | 'no' | 'unknown'; freshPage: boolean }
export function restartOf(o: { marker: Phase1Marker; process: string | null; pageStartedAt: number; phase1StateLeft: boolean }): Restart {
  const process = !o.marker.process || !o.process ? 'unknown' : o.marker.process === o.process ? 'no' : 'yes';
  return { process, freshPage: o.pageStartedAt > o.marker.at && !o.phase1StateLeft };
}

export interface Phase2Result {
  test: 'native-chat-restart'; run: string; phase1: string | null; ok: boolean; restarted: Restart | null;
  loadedFrom: string; sameChat: boolean; probe: ProbeResult; failed: string[];
}

/** Phase 2: ok when phase 1 passed, and its chat (the same CLI session) is listed under "On this tablet" with your
 *  message and the reply shown. Whether the app really restarted is reported, not required (see restartOf). */
export function buildPhase2(o: { run: string; marker: Phase1Marker | null; sessionId: string | null; process: string | null;
  pageStartedAt: number; phase1StateLeft: boolean; loadedFrom: string; probe: UiProbe }): Phase2Result {
  const p = probeResult(o.probe), m = o.marker;
  const sameChat = !!m?.sessionId && m.sessionId === o.sessionId;
  const failed: string[] = [];
  if (!m) failed.push('no phase 1 pass');
  else if (!sameChat) failed.push('not the phase 1 chat');
  if (!p.listed) failed.push('not listed');
  if (p.messagesShown < 2) failed.push('messages missing');
  return { test: 'native-chat-restart', run: o.run, phase1: m?.run ?? null, ok: failed.length === 0,
    restarted: m ? restartOf({ marker: m, process: o.process, pageStartedAt: o.pageStartedAt, phase1StateLeft: o.phase1StateLeft }) : null,
    loadedFrom: o.loadedFrom, sameChat, probe: p, failed };
}

/** The text the PC log gets for phase 2: every line starts with "uitest2:". */
export function phase2Text(r: Phase2Result): string {
  const re = r.restarted ? ` restarted=${r.restarted.process} freshPage=${r.restarted.freshPage ? 'yes' : 'no'}` : '';
  return `uitest2: ${r.test} run=${r.run} phase1=${r.phase1 ?? 'none'} ${r.ok ? 'PASS' : `FAIL (${r.failed.join(', ')})`}${re} from=${r.loadedFrom}`
    + `\nuitest2: ${JSON.stringify(r)}`;
}
