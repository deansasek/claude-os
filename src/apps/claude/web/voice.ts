// Talking to Claude on the desk tablet: "Hey Claude, …" → a session → the answer, spoken.
//
// The tablet does the listening (wake word and speech-to-text, offline: android/VOICE.md) and the
// speaking; this file decides what a request means and follows the turn through:
//   - a session is open on screen and can take a reply  → the request is a reply to it
//   - otherwise                                          → a new session, in the folder you name
//     ("Hey Claude, in eBay Cards, …") or in Scratch space
//   - Claude asks for permission while you're talking    → it asks out loud; "yes"/"allow" or "no"/"deny"
// When the answer has been spoken it listens a few seconds more, so you can answer back without
// "Hey Claude"; silence ends the conversation. Tap the critter or the voice pill, say "stop", or just
// talk over it to interrupt. "Hey Claude, stop" while Claude is working stops the turn.
//
// What you see is the system-wide voice indicator (core/web/voice-ui.ts): it works on every screen,
// so a voice request no longer pulls you into this app; tap the pill while Claude works to come here.
import { getJson, report } from '../../../core/web/dom.ts';
import { voice, type VoiceEvent } from '../../../core/web/device.ts';
import type { AppContext } from '../../../core/web/shell.ts';
import { voiceUi } from '../../../core/web/voice-ui.ts';
import { runCommand } from '../../../core/web/voice-commands.ts';
import type { HubTurn, Project, SessionView } from '../api.ts';
import { flag, react, sayLine } from './critter.ts';
import { apiCall, chosenFolder, currentSession, openSession, refreshView, unlocked, viewNow, voiceAnswer, voiceNew, voiceReply } from './reply.ts';
import { setMicHandler, type MicTarget } from './sessions/mic.ts';

/** Where the composer's mic said the words should go (set when it's tapped, used for the next request). */
let micTarget: { target: MicTarget; at: number } | null = null;

const FOLLOW_UP_MS = 7000;      // after Claude speaks: how long to wait for you to start answering
const APPROVAL_LISTEN_MS = 9000;
const WATCH_MS = 20 * 60e3;     // give up following a turn after this long

let ctx: AppContext;
/** The conversation in progress: which session, which turn we're waiting on, what we last said. */
let convo: { sessionId: string; turnId: string | null; token: number } | null = null;
let token = 0;
let expect: 'request' | 'followup' | 'approval' = 'request';
let speakingId = '';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const say = (text: string, id = `say-${Date.now()}`) => { speakingId = id; voiceUi.say(text, id); };
let retried = false;   // one "didn't catch that, try again" per request

// ---------- turning Claude's Markdown into something worth hearing ----------
/** Short, plain sentences: no code, tables, links or paths; long answers are cut with a pointer to the screen. */
export function speakable(md: string, max = 340): string {
  let more = false;
  let s = md.replace(/```[\s\S]*?(```|$)/g, () => { more = true; return '\n'; });
  s = s.split('\n').filter(l => { if (/^\s*\|.*\|\s*$/.test(l)) { more = true; return false; } return true; }).join('\n');
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/`([^`\n]{1,32})`/g, '$1').replace(/`[^`\n]*`/g, 'that')
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w .@-]+){2,}/g, m => m.split(/[\\/]/).pop() || m)
    .replace(/^\s{0,3}#{1,6}\s*/gm, '').replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '').replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/\p{Extended_Pictographic}/gu, '');
  const lines = s.split('\n').map(l => l.trim()).filter(Boolean).map(l => (/[.!?:;,]$/.test(l) ? l : l + '.'));
  const sentences = lines.join(' ').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
  let out = '';
  for (const x of sentences) {
    if (out && out.length + x.length + 1 > max) { more = true; break; }
    out += (out ? ' ' : '') + x;
  }
  if (out.length > max + 80) { out = out.slice(0, max).replace(/\s+\S*$/, '') + '…'; more = true; }
  if (!out) return more ? 'Done. The details are on the screen.' : 'Done.';
  return more ? `${out} There’s more on the screen.` : out;
}

// ---------- what was said ----------
const CANCEL = /^(stop|cancel|never ?mind|nothing|forget it|no thanks|that's all|thats all|thank you|thanks)$/;
// Approvals by voice take a clear, whole answer only: a stray "okay" or a word misheard from the room
// must never allow anything. ("no" is looser: denying is always safe.)
const YES = /^(?:yes|yeah|yep|yes please|yes allow it|yes go ahead|allow|allow it|approve|approve it|go ahead|do it|please do)$/;
const NO = /^(no|nope|deny|don't|dont|do not|stop|cancel|reject|nah)\b/;

/** "in eBay Cards, list my drafts" → that folder and "list my drafts". */
function folderFrom(text: string, projects: Project[]): { project: Project | null; rest: string } {
  const t = norm(text);
  for (const p of projects) {
    const n = norm(p.name);
    if (!n || p.name === 'Scratch space') continue;
    const m = t.match(new RegExp(`^(?:in|on|for|inside|using)\\s+(?:the\\s+|my\\s+)?${n.replace(/ /g, '\\s*')}(?:\\s+(?:folder|project|repo))?\\s+(.+)$`));
    if (m) return { project: p, rest: m[1] };
  }
  return { project: null, rest: text };
}

async function handle(raw: string): Promise<void> {
  const text = raw.replace(/^(?:hey\s+)?claude\b[\s,]*/i, '').trim();
  const t = norm(text);
  report('voice-request');
  if (!t) { sayLine('hmm?'); return; }

  // an approval is waiting on the screen: yes / no
  const v = viewNow();
  const approval = v?.turn?.status === 'approval' ? v.turn.approval : null;
  if (approval) {
    if (YES.test(t)) { answerApproval(true); return; }
    if (NO.test(t)) { answerApproval(false); return; }
    say('Should I allow it? Say yes or no.', 'approval-again'); expect = 'approval';
    return;
  }
  // "stop" / "cancel" while Claude is working on what you asked: stop the turn
  if (CANCEL.test(t) && convo?.turnId && v?.turn?.id === convo.turnId && v.turn.status === 'running') {
    const turn = convo.turnId;
    // the conversation stays until the PC answers: a failed stop leaves the turn running, so "stop" can be said again
    let r: { ok: boolean; error?: string } | null;
    try { r = await unlocked(() => apiCall<{ ok: boolean; error?: string }>('stop', { turn })); }
    catch { r = { ok: false, error: 'unreachable' }; }
    void refreshView();
    if (r === null) { needPin(); return; }   // the PIN pad came up and the stop did not run
    if (r.ok) {
      convo = null; voiceUi.setBase({ kind: 'idle' });
      voiceUi.notice('Stopped Claude', 'It won’t finish that one');
    } else if (r.error === 'not_running') {
      // the turn finished before the stop reached the PC: the answer is already on screen
      convo = null; voiceUi.setBase({ kind: 'idle' });
      voiceUi.notice('Claude already finished', 'Nothing to stop.');
    } else if (r.error === 'unreachable') {
      voiceUi.notice('Couldn’t stop Claude', 'Can’t reach your PC. Try again.');
    } else {
      voiceUi.notice('Couldn’t stop Claude', 'Try again in a moment.');
    }
    return;
  }
  if (CANCEL.test(t)) { sayLine('ok!'); voiceUi.notice('Okay', ''); convo = null; voiceUi.setBase({ kind: 'idle' }); expect = 'request'; return; }
  // quick commands (timers, alarms, weather, time, screen, volume, apps) are done right here, without Claude;
  // not when the composer's mic was tapped, which means "this is a message for Claude"
  const fromMic = !!micTarget && Date.now() - micTarget.at < 60e3;
  if (!fromMic) {
    const done = await runCommand(text).catch(() => null);
    if (done) {
      report('voice-command');
      if (done.react) react(done.react, done.react === 'look' ? 3200 : done.react === 'wave' ? 2400 : done.react === 'love' ? 1600 : 800);
      if (done.say) say(done.say, `cmd-${Date.now()}`);   // '' : the command speaks for itself (a routine)
      expect = 'request'; retried = false;
      return;
    }
  }
  // one stray word on its own is almost always a mishearing: ask again once
  if (expect === 'request' && t.split(' ').length === 1 && !retried) {
    retried = true;
    voiceUi.notice('Didn’t catch that', 'Try again, I’m listening', 1500);
    setTimeout(() => voiceUi.listenAgain(6000), 600);
    return;
  }
  retried = false;

  // the composer's mic was tapped: the words go where it pointed (a reply, or a new session in its folder)
  const mic = micTarget && Date.now() - micTarget.at < 60e3 ? micTarget.target : null;
  micTarget = null;
  if (mic?.kind === 'session') {
    const mv = viewNow();
    if (mv?.session?.id === mic.sessionId && mv.canReply) { await send(() => voiceReply(mic.sessionId, text), mic.sessionId); return; }
  }
  const micFolder = mic?.kind === 'new' ? mic.projectId : null;

  // a reply to the session on screen, if it can take one
  const open = mic?.kind === 'new' ? null : currentSession();
  if (open && v && v.canReply) { await send(() => voiceReply(open, text), open); return; }
  if (open && v?.reason === 'running') { say('Claude is still working on that one.'); return; }

  // otherwise a new session
  // a failed read is not an empty list: only a read that worked can say there is no Scratch space
  let projects: Project[];
  try { projects = await getJson<Project[]>('/api/claude/projects'); }
  catch { voiceUi.notice('Can’t reach your PC', 'ClaudeOS runs there; is it on?', 4000); say('I can’t reach your PC right now.'); return; }
  const { project, rest } = folderFrom(text, projects);
  // the folder you named, else the one the mic / new-session screen points at, else Scratch space
  const pickedId = micFolder || chosenFolder()?.id || null;
  const where = project || (pickedId && projects.find(p => p.id === pickedId)) || projects.find(p => p.name === 'Scratch space') || null;
  if (!where) { voiceUi.notice('Scratch space missing', 'Add a Scratch space project on your PC', 4000); say('I need a Scratch space project on your PC first.'); return; }
  sayLine(where.name !== 'Scratch space' ? `in ${where.name}…` : 'on it!');
  voiceUi.setBase({ kind: 'thinking', title: 'Starting…', sub: `New session in ${where.name}`, onTap: openHere });
  const mine = ++token;
  // the rest happens inside, so it still happens if the PIN pad comes up first
  const r = await unlocked(async () => {
    const res = await voiceNew(where.id, rest);
    if (!res.ok || !res.sessionId) failed(res.error === 'too_many' ? 'Two sessions are already working. Try again in a moment.' : 'That didn’t start. Try again in a moment.');
    else if (mine === token) { openSession(res.sessionId); follow(res.sessionId, null, mine); }
    return res;
  }).catch(() => { failed('I can’t reach your PC right now.'); return undefined; });
  if (r === undefined) return;
  if (r == null) needPin();
}

async function send(go: () => Promise<{ ok: boolean; error?: string; turn?: HubTurn }>, sessionId: string): Promise<void> {
  const mine = ++token;
  react('hop', 800, 'on it!');
  voiceUi.setBase({ kind: 'thinking', title: 'Sending…', sub: viewNow()?.session?.title || '', onTap: openHere });
  const r = await unlocked(async () => {
    const res = await go();
    if (!res.ok) failed(res.error === 'open_on_pc' ? 'That session is open on your PC, so answer it there.' : 'I couldn’t send that. Try again in a moment.');
    else { void refreshView(); if (mine === token) follow(sessionId, res.turn?.id || null, mine); }
    return res;
  }).catch(() => { failed('I can’t reach your PC right now.'); return undefined; });
  if (r === undefined) return;
  if (r == null) needPin();
}

const openHere = () => { ctx.requestAttention(); };
function failed(words: string): void { voiceUi.setBase({ kind: 'idle' }); say(words); }
function needPin(): void {
  ctx.requestAttention();   // the PIN pad is in this app
  voiceUi.setBase({ kind: 'idle' });
  voiceUi.notice('Enter your PIN first', 'Then your request goes through', 5000);
  say('Enter your PIN on the screen first.');
}

function answerApproval(allow: boolean): void {
  voiceAnswer(allow);
  react(allow ? 'love' : 'look', 1600, allow ? 'allowed!' : 'ok, denied');
  voiceUi.setBase({ kind: 'thinking', title: allow ? 'Allowed, carrying on…' : 'Denied, carrying on…', sub: convo ? viewNow()?.session?.title || '' : '', onTap: openHere });
  expect = 'request';
}

function follow(sessionId: string, turnId: string | null, mine: number): void {
  convo = { sessionId, turnId, token: mine };
  void watch(convo);
}

// ---------- following the turn, and speaking the answer ----------
async function watch(c: NonNullable<typeof convo>): Promise<void> {
  const until = Date.now() + WATCH_MS;
  const asked = new Set<string>();
  let seenRunning = false;
  while (Date.now() < until && convo === c) {
    await new Promise(r => setTimeout(r, 1500));
    let v: SessionView;
    try { v = await getJson<SessionView>(`/api/claude/session?id=${encodeURIComponent(c.sessionId)}`); } catch { continue; }
    const t = v.turn;
    if (!t || (c.turnId && t.id !== c.turnId)) continue;
    if (!c.turnId) c.turnId = t.id;
    if (convo !== c) return;
    const title = v.session?.title || t.title || '';
    if (t.status === 'running') {
      seenRunning = true;
      const step = t.progress[t.progress.length - 1] || '';
      const real = step && !/^(Starting a new session|Sending your reply)$/.test(step);
      voiceUi.setBase({ kind: 'thinking', title: real ? 'Working…' : 'Thinking…', sub: real ? `${step} · ${title}` : title, onTap: openHere });
      continue;
    }
    if (t.status === 'approval' && t.approval) {
      seenRunning = true;
      if (asked.has(t.approval.id)) continue;
      asked.add(t.approval.id);
      const what = t.approval.summary.charAt(0).toLowerCase() + t.approval.summary.slice(1);
      expect = 'approval';
      voiceUi.setBase({ kind: 'ask', title: `Allow Claude to ${what}?`, sub: 'Say yes or no, or tap',
        actions: [{ label: 'Deny', run: () => answerApproval(false) }, { label: 'Allow', primary: true, run: () => answerApproval(true) }] });
      say(`Claude wants to ${speakable(what, 120).replace(/\.$/, '')}. Should I allow it?`, `approval-${t.approval.id}`);
      continue;
    }
    if (t.status === 'done') {
      // stays "thinking" until the voice actually starts, so the pill doesn't blink out in between
      voiceUi.setBase({ kind: 'thinking', title: 'Answering…', sub: title, onTap: openHere });
      expect = 'followup'; say(speakable(t.reply || v.lastText || ''), `reply-${t.id}`);
    } else {
      voiceUi.setBase({ kind: 'idle' });
      if (t.status === 'error') { say('Something went wrong with that one. The details are on the screen.'); convo = null; }
      else convo = null;   // stopped: say nothing
    }
    return;
  }
  if (convo === c || !convo) voiceUi.setBase({ kind: 'idle' });
  if (!seenRunning) convo = null;
}

// ---------- events from the tablet ----------
// (the indicator itself follows these on its own; here: the critter, and what happens next)
function onEvent(e: VoiceEvent): void {
  switch (e.type) {
    case 'wake':
      micTarget = null;   // "Hey Claude" goes by the usual rules, not an old mic tap
      flag('listening', true);
      react('hop', 800, 'yes?');
      expect = viewNow()?.turn?.status === 'approval' ? 'approval' : 'request';
      break;
    case 'bargein':
      flag('speaking', false); flag('listening', true);
      if (expect === 'followup') expect = 'request';   // talking over the answer: a new request (to the same session)
      break;
    case 'state':
      flag('listening', e.mode === 'listening');
      break;
    case 'partial':
      sayLine(e.text.length > 60 ? '…' + e.text.slice(-58) : e.text);
      break;
    case 'final':
      flag('listening', false);
      sayLine(e.text.length > 60 ? e.text.slice(0, 58) + '…' : e.text);
      void handle(e.text);
      break;
    case 'timeout': case 'cancel':
      flag('listening', false);
      if (expect === 'followup') convo = null;   // silence after an answer: the conversation is over
      expect = viewNow()?.turn?.status === 'approval' ? 'approval' : 'request';
      retried = false;
      break;
    case 'speaking':
      flag('speaking', true);
      if (e.id.startsWith('reply-')) voiceUi.setBase({ kind: 'idle' });   // the "Answering…" hand-off
      break;
    case 'spoken':
      flag('speaking', false);
      if (e.id.startsWith('reply-')) voiceUi.setBase({ kind: 'idle' });
      if (e.stopped || e.id !== speakingId) { if (e.stopped && expect !== 'approval') expect = 'request'; break; }
      // answered, or asked something: listen for a moment without the wake word
      if (expect === 'followup' && convo) voiceUi.followUp(FOLLOW_UP_MS);
      else if (expect === 'approval' && viewNow()?.turn?.status === 'approval') voiceUi.followUp(APPROVAL_LISTEN_MS);
      break;
    case 'stop':
      flag('speaking', false);
      expect = 'request';
      sayLine('ok!');
      break;
    case 'error':
      flag('listening', false); flag('speaking', false);
      console.warn('voice:', e.message);
      break;
  }
}

/** Tapping the critter while it talks stops it. Returns true if it was talking. */
export function tapToStop(): boolean {
  if (!ctx.root.classList.contains('speaking')) return false;
  try { voice.stopSpeaking(); } catch { /* ignore */ }
  expect = 'request';
  return true;
}

export function initVoice(context: AppContext): void {
  ctx = context;
  if (!voice.available) return;
  voiceUi.init();
  // tapping the idle spark or a mic button (#svMic): talk to Claude, about the session on screen if there is one
  const talk = () => {
    if (voiceUi.isStarting()) return;   // a listen is already queued: do not queue another
    expect = viewNow()?.turn?.status === 'approval' ? 'approval' : 'request';
    retried = false;
    // the tablet says no (no permission, it's busy, no voice…) either by throwing or with ok: false and a reason
    let r: { ok: boolean; reason?: string } = { ok: false };
    try { r = voice.listen(8000); } catch { /* no bridge: the same notice as no permission */ }
    if (!r.ok) {
      const reason = r.reason ?? 'no_mic';   // (an older tablet app gives no reason: it's the microphone)
      const mic = reason === 'no_mic' || reason === 'mic_busy';
      voiceUi.notice(mic ? 'The microphone isn’t available' : 'Voice isn’t working right now', voiceUi.reasonLine(reason), 4000);
      return;
    }
    // the tablet said ok: the listen is queued. While its speech model loads, the pill shows "Starting voice…"
    // and a failed start shows its own notice (a tablet error event or the queue time limit), not a guess here
    voiceUi.queueListen();
  };
  voiceUi.onTalk(() => { micTarget = null; talk(); });
  // the session composer's mic (#svMic): a toggle; the words go where it points
  setMicHandler(target => {
    if (voiceUi.isListening()) { voiceUi.cancelListening(); micTarget = null; return; }
    if (voiceUi.isStarting()) return;   // a listen is already queued
    try { voice.stopSpeaking(); } catch { /* ignore */ }
    micTarget = { target, at: Date.now() };
    talk();
  });
  voice.on(onEvent);
}
