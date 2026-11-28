// Claude control: a session's browser tools (read the page, click, type, screenshot) run on the tablet's Browser.
// The tools live in this process (createSdkMcpServer; turns.ts adds them to each session). Each call becomes a job:
// the Claude page on the tablet long-polls for it (POST browser/next), runs it through the Browser's native bridge,
// and posts the answer back (POST browser/result). Nothing runs unless the tablet is listening, and the tablet stops
// listening after a few idle minutes, so the PIN lock applies again. Approvals: each call is a tool call, so it goes
// through canUseTool like any other tool (an approval card on the tablet first).
// The same relay carries the tablet tools' jobs (server/tablet.ts: timers, alarms, reminders, notices).
// Trust: the relay routes follow the Claude routes' rule (guard.ts checkToken): with no PIN set, any device on the
// home network can poll for jobs or answer them. That was kept on purpose; setting a PIN closes it.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export type BrowserOp = 'read' | 'click' | 'type' | 'screenshot' | 'open' | 'back';
/** The tablet tools' jobs (server/tablet.ts): run by the Clock and the notices on the tablet; 'routine' is
 *  run_routine's (routines/server/tools.ts), run by the Routines app's runner on the tablet. */
export type TabletOp = 'timer' | 'alarm' | 'reminder' | 'notify' | 'routine' | 'clock_status' | 'cancel_timer' | 'cancel_alarms' | 'tablet_status' | 'dnd' | 'pause_timer' | 'resume_timer' | 'adjust_timer' | 'list_alarms';
/** A job for the tablet. Browser jobs use ref and text; tablet jobs carry their checked arguments in args. */
export interface BrowserJob { id: string; op: BrowserOp | TabletOp; ref?: string; text?: string; args?: Record<string, unknown> }
export interface BrowserAnswer { ok: boolean; data: string }

interface Pending { job: BrowserJob; done: (a: BrowserAnswer) => void; taken: () => void }

const CALL_MS = 20e3;          // a call that the tablet doesn't answer in this long fails
const POLL_MS = 15e3;          // how long one long poll waits for a job
const LISTEN_MS = 30e3;        // no poll for this long: the tablet isn't listening
const WAKE_MS = 12e3;          // ...but a call still waits this long for it to start (it starts while a turn runs)

const queued: Pending[] = [];                    // waiting for the tablet to take them
const sent = new Map<string, Pending>();         // taken by the tablet, waiting for its answer
let pollers: ((job: BrowserJob | null) => void)[] = [];
let lastPollAt = 0;
let seq = 0;

const NOT_LISTENING = 'The tablet isn’t listening. Open Claude on the tablet, unlock it if asked, then try again.';
const LATE = 'The tablet didn’t answer in time. Try again.';

/** A tool call: queue the job for the tablet and wait for its answer. */
export function callTablet(op: BrowserOp, ref?: string, text?: string): Promise<BrowserAnswer> {
  return sendJob({ op, ref, text });
}

/**
 * Queue a job and wait for the tablet's answer. A tablet that isn't polling gets WAKE_MS to start (the tablet starts
 * polling whenever it sees a running turn, and the approval card for this call comes first), else the call fails.
 */
export function sendJob(fields: Omit<BrowserJob, 'id'>): Promise<BrowserAnswer> {
  const listening = Date.now() - lastPollAt <= LISTEN_MS;
  return new Promise<BrowserAnswer>(done => {
    const job: BrowserJob = { id: `b${++seq}`, ...fields };
    const expire = (why: string) => () => {
      const i = queued.findIndex(p => p.job.id === job.id);
      if (i >= 0) queued.splice(i, 1);
      sent.delete(job.id);
      done({ ok: false, data: why });
    };
    let timer = setTimeout(expire(listening ? LATE : NOT_LISTENING), listening ? CALL_MS : WAKE_MS);
    const p: Pending = {
      job,
      done: a => { clearTimeout(timer); done(a); },
      // taken by a poll: from now on the tablet has CALL_MS to answer
      taken: () => { if (!listening) { clearTimeout(timer); timer = setTimeout(expire(LATE), CALL_MS); } },
    };
    const waiter = pollers.shift();
    if (waiter) { sent.set(job.id, p); p.taken(); waiter(job); }
    else queued.push(p);
  });
}

/** The tablet's long poll: the next job, or null after POLL_MS with none. */
export function nextJob(signal?: AbortSignal): Promise<BrowserJob | null> {
  lastPollAt = Date.now();
  const p = queued.shift();
  if (p) { sent.set(p.job.id, p); p.taken(); return Promise.resolve(p.job); }
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise<BrowserJob | null>(resolve => {
    // the waiter leaves the queue when the poll ends, so no job is handed to a caller that has gone
    const finish = (job: BrowserJob | null) => {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
      resolve(job);
    };
    const wake = (job: BrowserJob | null) => finish(job);
    const onAbort = () => { pollers = pollers.filter(w => w !== wake); finish(null); };
    const t = setTimeout(() => { pollers = pollers.filter(w => w !== wake); finish(null); }, POLL_MS);
    pollers.push(wake);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** The tablet's answer to a job. Unknown or late ids are ignored. */
export function finishJob(id: string, ok: boolean, data: string): void {
  const p = sent.get(id);
  if (!p) return;
  sent.delete(id);
  p.done({ ok, data });
}

/** A tool result: a page or a message as text; a screenshot as a picture. */
function toResult(op: BrowserOp, a: BrowserAnswer) {
  if (!a.ok) return { content: [{ type: 'text' as const, text: a.data }], isError: true };
  if (op === 'screenshot') {
    const m = /^data:(image\/[a-z]+);base64,(.*)$/s.exec(a.data);
    if (m) return { content: [{ type: 'image' as const, data: m[2], mimeType: m[1] }] };
  }
  return { content: [{ type: 'text' as const, text: a.data || 'Done.' }] };
}

export const MAX_OPEN = 500;
/** A scheme with no space and no port after its colon ("javascript:…", "file:///…", "mailto:…"); "localhost:8080" is not one. */
const SCHEME = /^([a-z][a-z0-9+.-]*):(?!\d)/i;

/**
 * browser_open's input, checked before it goes to the tablet: an address or words to search, trimmed, at most
 * MAX_OPEN characters, no control characters, and no scheme other than http or https. The tablet then reads it as its
 * address bar does (state.ts reading(): an address gets https://, local hosts http://, anything else is a search) and
 * checks the result is http(s) again. The Browser's own rules still apply there (BrowserView.allowed: http and https
 * only, plain http upgraded to https except for the Hub and home-network addresses). There is no list of blocked sites.
 * Returns the text to send, or { error } with the reason.
 */
export function checkOpen(input: unknown): { text: string } | { error: string } {
  if (typeof input !== 'string') return { error: 'Give an address or words to search.' };
  const text = input.trim();
  if (!text) return { error: 'Give an address or words to search.' };
  if (text.length > MAX_OPEN) return { error: `That is too long to open (the most is ${MAX_OPEN} characters).` };
  // control characters (C0, DEL, C1), invisible format characters (bidi overrides, zero-width), line and paragraph separators
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(text)) return { error: 'That has control characters in it. Give a plain address or search.' };
  const m = /\s/.test(text) ? null : SCHEME.exec(text);
  if (m && !/^https?$/i.test(m[1])) return { error: `The Browser only opens http and https addresses, not ${m[1].toLowerCase()}:.` };
  if (/^https?:/i.test(text)) {
    let u: URL;
    try { u = new URL(text); } catch { return { error: 'That isn’t a valid address.' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'The Browser only opens http and https addresses.' };
    if (!u.hostname) return { error: 'That address has no site in it.' };
    if (u.username || u.password) return { error: 'The Browser won’t open an address with a name or password in it.' };
  }
  return { text };
}

/** The six tools, as one in-process MCP server for a session. */
export const browserServer = createSdkMcpServer({
  name: 'claudeos_browser',
  version: '1.0.0',
  tools: [
    tool('browser_open',
      'Open a web address or a search in ClaudeOS’s Browser on the tablet, in a new tab that comes on screen. '
      + 'Give an address ("example.com", "https://…") or words to search ("lasagne recipe"), as typed in the address bar. '
      + 'Afterwards browser_read_page, browser_click, browser_type and browser_screenshot work on that tab.',
      { url: z.string().describe('An address or words to search, at most 500 characters.') },
      async ({ url }) => {
        const c = checkOpen(url);
        if ('error' in c) return { content: [{ type: 'text' as const, text: c.error }], isError: true };
        return toResult('open', await callTablet('open', undefined, c.text));
      }),
    tool('browser_back',
      'Go back one page in the current tab of ClaudeOS’s Browser on the tablet.',
      {},
      async () => toResult('back', await callTablet('back'))),
    tool('browser_read_page',
      'Read the page open in ClaudeOS’s Browser on the tablet: its address, title, text, and its links and fields. Each link and field has a ref for browser_click and browser_type.',
      {},
      async () => toResult('read', await callTablet('read'))),
    tool('browser_click',
      'Click a link or button on the page open in ClaudeOS’s Browser, by its ref from browser_read_page.',
      { ref: z.string() },
      async ({ ref }) => toResult('click', await callTablet('click', ref))),
    tool('browser_type',
      'Type text into a field on the page open in ClaudeOS’s Browser, by its ref from browser_read_page. Replaces what the field holds.',
      { ref: z.string(), text: z.string() },
      async ({ ref, text }) => toResult('type', await callTablet('type', ref, text))),
    tool('browser_screenshot',
      'A picture of the page open in ClaudeOS’s Browser on the tablet.',
      {},
      async () => toResult('screenshot', await callTablet('screenshot'))),
  ],
});
