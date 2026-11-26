// Look: the camera full screen, and Claude looks when you ask. Each spoken request (the tablet's
// "Hey Claude, …" → its final words) takes ONE photo, sends it with the words to Claude, and speaks the answer.
// Nothing is captured in between: a frame is taken only for a request. On screen: what was heard, the photo
// Claude is looking at, and Claude's answer. "Stop looking" ends it.
//
// The first request starts a new session in Scratch space (with the "Hey Claude" defaults); the next ones
// go to that same session, while it can take a reply. The requests are held here (voice.claimFinals), so the
// Claude app doesn't also start a session for them. The voice indicator still shows on top.
import { getJson } from '../../../core/web/dom.ts';
import { voice } from '../../../core/web/device.ts';
import { voiceUi } from '../../../core/web/voice-ui.ts';
import type { HubTurn, NewSessionResult, Project, SessionView } from '../../claude/api.ts';
import { apiCall, unlocked } from '../../claude/web/reply.ts';
import { speakable } from '../../claude/web/voice.ts';
import { voiceDefaults, wantFor } from '../../claude/web/sessions/controls.ts';
import * as cam from './camera.ts';

interface LookParts {
  frame: HTMLElement;       // the Camera app's own preview box (where the preview goes back to)
  view: HTMLElement;        // Look's full-screen preview box
  overlay: HTMLElement;     // Look's overlay (hidden unless Look is on)
  main: HTMLElement;        // the Camera app's normal layout (hidden in Look)
  state: HTMLElement;       // what Look is doing now
  answer: HTMLElement;      // Claude's last answer, as text
  end: HTMLElement;         // the "Stop looking" button
  heard: HTMLElement;       // the words of the request being answered
  seen: HTMLElement;        // the box holding the photo Claude is looking at (hidden until one is taken)
  seenImg: HTMLImageElement;
}

const LISTEN = 'Say “Hey Claude”, then ask';   // Look is listening: the only state with the clay spark

let parts: LookParts;
let on = false, busy = false;
let sessionId: string | null = null;
let release: (() => void) | null = null;
let setLookClass: (on: boolean) => void = () => {};

const say = (text: string, id = `look-${Date.now()}`) => voiceUi.say(text, id);

/** What Look is doing now. `listening` (clay, turning spark) only while it waits for "Hey Claude". */
const setState = (text: string, listening = false) => {
  if (!on) return;
  parts.state.textContent = text;
  parts.overlay.classList.toggle('listening', listening);
};

export const isLooking = (): boolean => on;

/** Set up once (the Camera app's mount). `classOn` adds/removes the page classes that make the screen full. */
export function initLook(p: LookParts, classOn: (on: boolean) => void): void {
  parts = p;
  setLookClass = classOn;
  p.end.addEventListener('click', () => exitLook());
  // Look covers the Camera app's message box, so the camera's own state shows here too
  cam.onState((st, msg) => {
    if (!on) return;
    if (st === 'asking') setState('Starting the camera…', false);
    else if (st === 'error') setState(msg || 'The camera isn’t available right now.', false);
    else if (st === 'open' && !busy) setState(LISTEN, true);
  });
}

export function enterLook(): void {
  if (on || !cam.cameraAvailable) return;
  on = true; busy = false;
  parts.main.hidden = true;
  parts.overlay.hidden = false;
  parts.answer.hidden = true;
  parts.seen.hidden = true;
  parts.heard.textContent = '';
  setLookClass(true);
  setState(LISTEN, true);
  release = voice.claimFinals(text => { void ask(text); });
  cam.show(parts.view);   // the preview moves to the full screen (or opens there)
}

export function exitLook(): void {
  if (!on) return;
  on = false; busy = false;
  release?.(); release = null;
  sessionId = null;        // the next Look starts its own conversation
  parts.overlay.hidden = true;
  parts.overlay.classList.remove('listening');
  parts.main.hidden = false;
  setLookClass(false);
  cam.moveTo(parts.frame);
}

/** A spoken request: take the picture, show what was heard and seen, send both, and speak what comes back. */
async function ask(raw: string): Promise<void> {
  if (!on) return;
  const said = raw.replace(/^(?:hey\s+)?claude\b[\s,]*/i, '').trim();
  if (!said) { say('Go on. What should I look at?'); return; }
  if (busy) { say('I’m still on the last one.'); return; }
  busy = true;
  parts.heard.textContent = `“${said}”`;
  parts.answer.hidden = true;
  parts.seen.hidden = true;
  setState('Looking…');
  try {
    const shot = await cam.takePhoto();
    if (!shot.ok) { say(shot.code === 'busy' ? 'The camera is busy. Try again in a moment.' : 'I couldn’t take that picture. Try again.'); return; }
    parts.seenImg.src = shot.url;
    parts.seen.hidden = false;
    setState('Thinking…');
    const started = await send(said, [shot.id]);
    if (started) await follow(started.sessionId, started.turnId);
  } catch (e) {
    console.error('look', e);
    say('Something went wrong with that one.');
  } finally {
    busy = false;
    setState(LISTEN, true);
  }
}

/** Send the words and the photo: to the Look session if it can take a reply, else a new one in Scratch space. */
async function send(text: string, photoIds: string[]): Promise<{ sessionId: string; turnId: string | null } | null> {
  if (sessionId) {
    // a failed read is not a finished session: say the PC could not be reached
    let v: SessionView;
    try { v = await getJson<SessionView>(`/api/claude/session?id=${encodeURIComponent(sessionId)}`); }
    catch { say('I can’t reach your PC right now. Check that it’s on and ClaudeOS is running.'); return null; }
    if (v.canReply) {
      const id = sessionId;
      const r = await unlocked(() => apiCall<{ ok: boolean; error?: string; turn?: HubTurn }>('reply', { id, text, photoIds, ...wantFor(id) }));
      if (r == null) { say('Enter your PIN on the screen first.'); return null; }
      if (!r.ok) { say('I couldn’t send that. Try again in a moment.'); return null; }
      return { sessionId: id, turnId: r.turn?.id || null };
    }
    if (v.reason === 'running') { say('Claude is still working on the last one.'); return null; }
    sessionId = null;   // the session has gone on: start a fresh one below
  }
  const projects = await getJson<Project[]>('/api/claude/projects').catch(() => [] as Project[]);
  const scratch = projects.find(p => p.name === 'Scratch space');
  if (!scratch) { say('I can’t reach your PC right now. Check that it’s on and ClaudeOS is running.'); return null; }
  const r = await unlocked(() => apiCall<NewSessionResult>('new', { project: scratch.id, text, photoIds, voice: true, ...voiceDefaults() }));
  if (r == null) { say('Enter your PIN on the screen first.'); return null; }
  if (!r.ok || !r.sessionId) { say('That didn’t start. Try again in a moment.'); return null; }
  sessionId = r.sessionId;
  return { sessionId, turnId: null };
}

/** Follow the turn until Claude has answered, then say it (and show it). */
async function follow(id: string, turnId: string | null): Promise<void> {
  const until = Date.now() + 3 * 60e3;
  while (Date.now() < until && on) {
    await new Promise(r => setTimeout(r, 1500));
    let v: SessionView;
    try { v = await getJson<SessionView>(`/api/claude/session?id=${encodeURIComponent(id)}`); } catch { continue; }
    const t = v.turn;
    if (!t || (turnId && t.id !== turnId)) continue;
    if (!turnId) turnId = t.id;
    if (t.status === 'running') {
      const step = t.progress[t.progress.length - 1] || '';
      setState(step && !/^(Starting a new session|Sending your reply)$/.test(step) ? 'Working…' : 'Thinking…', false);
      continue;
    }
    if (t.status === 'approval') {
      setState('Needs your OK', false);
      say('Claude needs your OK. Open ClaudeOS to answer.');
      return;
    }
    if (t.status === 'done') {
      const text = speakable(t.reply || v.lastText || '');
      parts.answer.textContent = text;
      parts.answer.hidden = false;
      say(text, `look-${t.id}`);
      return;
    }
    if (t.status === 'error') {
      parts.answer.textContent = 'That one went wrong. The details are on the screen.';
      parts.answer.hidden = false;
      say('Something went wrong with that one. The details are on the screen.');
    }
    return;   // stopped: say nothing
  }
  // The three minutes ran out with no answer: say so, and say where the answer will be.
  if (!on) return;
  const line = 'Claude is still working on it. Open ClaudeOS to see the answer.';
  parts.answer.textContent = line;
  parts.answer.hidden = false;
  say(line);
}
