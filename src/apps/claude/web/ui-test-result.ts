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
