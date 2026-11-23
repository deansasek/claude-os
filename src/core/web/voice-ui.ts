// The voice indicator: one small, calm piece of UI that shows what Claude Home's voice is doing,
// on every screen (it lives on the stage, above the apps, below the control center).
//
//   idle        the rail's Voice item, muted; with "Hey Claude" on, a clay dot on its icon. Tap it to talk.
//   attentive   heard "Hey Claude": the pill rises, the spark opens up. "Listening…"
//   listening   a live level meter from the tablet's mic, and your words as they're recognised.
//               In the follow-up window after an answer, a thin line runs down the time left.
//   heard       what you said, for a beat
//   thinking    the spark turns while Claude works, with its latest step (set by the app)
//   speaking    a soft ink waveform and the words being said. Tap to stop, or just start talking.
//   ask         a question with buttons (e.g. an approval: Allow / Deny), also answerable by voice
//   notice      "Didn't catch that", "Stopped"… for a couple of seconds
//
// The tablet's events (core/web/device.ts `voice.on`) drive the live states on their own; an app
// sets what sits underneath them (`setBase`: idle / thinking / ask) and speaks through `say`.
// Anything with a data-voice-mic attribute becomes a tap-to-talk button; it and the session composer's
// #svMic (wired through its own hook) get the class `voice-live` while it is listening. Styles are injected from here (no shared CSS).
import { voice, voiceOffReason, type VoiceEvent, type VoiceReason } from './device.ts';
import { SPARK_SHAPE } from './dom.ts';
import { appIcon } from './app-icons.ts';
import { wake as wakeScreen } from './system.ts';

interface VoiceAction {label: string; primary?: boolean; run: () => void }
type VoiceBase =
  | { kind: 'idle' }
  | { kind: 'thinking'; title?: string; sub?: string; onTap?: () => void }
  | { kind: 'ask'; title: string; sub?: string; actions: VoiceAction[] };

type Live =
  | { kind: 'attentive' }
  | { kind: 'listening'; text: string; followUp: number }   // followUp: ms window, 0 = none
  | { kind: 'heard'; text: string }
  | { kind: 'speaking'; text: string }
  | { kind: 'notice'; title: string; sub: string };

let root: HTMLElement | null = null;
let dotEl: HTMLElement | null = null;       // the rail's voice item (built into #rail .rail-foot)
let base: VoiceBase = { kind: 'idle' };
let live: Live | null = null;
let liveTimer: number | undefined;
let pendingFollowUp = 0;                    // set just before asking the tablet to listen for a follow-up
let wakeOn = false;
let talkHandler: () => void = () => { try { voice.listen(6000); } catch { /* no mic */ } };
const spoken = new Map<string, string>();   // speech id → the words, to show while it's said
let level = 0, shown = 0;                    // mic level (target, smoothed)

// ---------- styles ----------
const CSS = `
.vx { position: absolute; inset: 0; z-index: 45; pointer-events: none; font-family: var(--sans); }
/* the voice item: a rail item at the foot (built into #rail .rail-foot), with the rail's own tile, icon and label.
   States: idle (muted, like the other items), wake (a clay dot: "Hey Claude" is on), listen (a clay tile whose ring
   follows the mic level), speak (the icon becomes a small waveform), think (the icon turns), off (dimmed). */
.vx-rail { transition: background-color var(--dur-base) var(--ease-out), color var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-out); }
.vx-rail .ri-icon { position: relative; }
.vx-rail .ri-icon svg { transition: opacity var(--dur-base) var(--ease-out); }
.vx-rail .vx-badge { display: none; position: absolute; top: -2px; right: -4px; width: 9px; height: 9px; border-radius: 50%; background: var(--clay); box-shadow: 0 0 0 2px var(--rail); }
.vx-rail.wake .vx-badge { display: block; }
.vx-rail.listen { background: var(--clay); color: #fff; box-shadow: 0 0 0 1px var(--clay); }
.vx-rail::after { content: ''; position: absolute; inset: -4px; border-radius: 18px; border: 2px solid var(--clay); opacity: 0; pointer-events: none; transition: opacity var(--dur-fast) var(--ease-out); }
.vx-rail.listen::after { opacity: calc(.2 + var(--lvl, 0) * .8); animation: vx-rail-pulse 1.8s ease-in-out infinite; }
@keyframes vx-rail-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
.vx-rail.think .ri-icon svg { animation: vx-think 2.4s cubic-bezier(.6,0,.3,1) infinite; }
.vx-rail-wave { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; gap: 3px; }
.vx-rail-wave i { width: 3px; height: 16px; border-radius: 2px; background: currentColor; transform: scaleY(.35); transition: transform var(--dur-fast) var(--ease-out); }
.vx-rail.speak .ri-icon svg { opacity: 0; }
.vx-rail.speak .vx-rail-wave { display: flex; }
.vx-rail.speak .vx-rail-wave i { animation: vx-rail-bar 1.1s ease-in-out infinite; }
.vx-rail.speak .vx-rail-wave i:nth-child(2) { animation-delay: -.25s; }
.vx-rail.speak .vx-rail-wave i:nth-child(3) { animation-delay: -.5s; }
.vx-rail.speak .vx-rail-wave i:nth-child(4) { animation-delay: -.75s; }
.vx-rail.speak .vx-rail-wave i:nth-child(5) { animation-delay: -.1s; }
@keyframes vx-rail-bar { 0%, 100% { transform: scaleY(.3); } 50% { transform: scaleY(1); } }
.vx-rail.off { opacity: .4; }   /* still tappable: a tap says why it can't listen, and the tooltip shows */
:root.reduce-motion .vx-rail::after, :root.reduce-motion .vx-rail.listen::after { animation: none; }
:root.reduce-motion .vx-rail.speak .vx-rail-wave i { animation: none; transform: scaleY(.7); }
:root.reduce-motion .vx-rail.think .ri-icon svg { animation: none; }
.vx-pill { position: absolute; left: calc(84px + (100% - 84px) / 2); bottom: 18px; min-width: 300px; max-width: 600px;
  display: flex; align-items: center; gap: 14px; padding: 10px 12px 10px 10px; box-sizing: border-box; border-radius: 30px;
  background: var(--card); color: var(--text); box-shadow: 0 0 0 1px var(--line), 0 12px 34px rgba(20,20,19,.16), 0 2px 6px rgba(20,20,19,.06);
  pointer-events: auto; cursor: pointer; overflow: hidden;
  opacity: 0; transform: translate(-50%, 24px) scale(.96); transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-slow) var(--ease-emph); }
:root[data-theme="dark"] .vx-pill { background: var(--card-2); box-shadow: 0 0 0 1px var(--line), 0 14px 40px rgba(0,0,0,.45); }
.vx.pill-on .vx-pill { opacity: 1; transform: translate(-50%, 0); }
.vx-vis { position: relative; flex: none; width: 44px; height: 44px; border-radius: 50%; background: var(--bg); display: grid; place-items: center; }
.vx-spark { width: 26px; height: 26px; transition: transform var(--dur-slow) var(--ease-emph), opacity var(--dur-base) var(--ease-out); }
.vx-wave { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 2.5px; opacity: 0; transition: opacity var(--dur-fast) var(--ease-out); }
.vx-wave i { width: 3px; height: 22px; border-radius: 2px; background: var(--clay); transform: scaleY(.12); transition: transform var(--dur-fast) var(--ease-out); }
.vx[data-s="listening"] .vx-wave, .vx[data-s="speaking"] .vx-wave { opacity: 1; }
.vx[data-s="listening"] .vx-spark, .vx[data-s="speaking"] .vx-spark { opacity: 0; transform: scale(.5); }
.vx[data-s="speaking"] .vx-wave i { background: var(--t2); }
.vx[data-s="attentive"] .vx-spark { animation: vx-pop .6s cubic-bezier(.2,.8,.2,1); }
.vx[data-s="thinking"] .vx-spark { animation: vx-think 2.4s cubic-bezier(.6,0,.3,1) infinite; }
.vx[data-s="notice"] .vx-spark { opacity: .45; }
.vx[data-s="notice"] .vx-spark g { fill: var(--t3); }
.vx-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.vx-txt b { font: 400 19px/1.25 var(--serif); letter-spacing: -.01em; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.vx[data-s="listening"] .vx-txt b, .vx[data-s="heard"] .vx-txt b { font-style: italic; }
.vx-txt span { font-size: 13px; color: var(--t3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vx-txt span:empty { display: none; }
.vx-acts { display: flex; gap: 8px; flex: none; }
.vx-acts:empty { display: none; }
.vx-acts button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; min-height: 44px; cursor: pointer; padding: 0 18px; border-radius: 99px; font: 500 14px var(--sans);
  color: var(--text); box-shadow: inset 0 0 0 1px var(--line); background: var(--bg); }
.vx-acts button.primary { background: var(--text); color: var(--bg); box-shadow: none; }
.vx-timer { position: absolute; left: 22px; right: 22px; bottom: 5px; height: 2px; border-radius: 2px; background: var(--clay); opacity: 0;
  transform-origin: 0 50%; }
.vx.timing .vx-timer { opacity: .55; }
@keyframes vx-pop { 0% { transform: scale(.55) rotate(-30deg); } 60% { transform: scale(1.12) rotate(6deg); } 100% { transform: none; } }
@keyframes vx-think { 0% { transform: rotate(0); } 100% { transform: rotate(180deg); } }
.voice-live { color: var(--clay) !important; box-shadow: 0 0 0 2px var(--clay) !important; }
`;

const RAYS = SPARK_SHAPE;   // the shared Claude spark (dom.ts)
const SPARK = `<svg viewBox="-50 -50 100 100"><g fill="var(--clay)">${RAYS}</g></svg>`;
const BARS = 9;

function build(stage: HTMLElement): HTMLElement {
  const style = document.createElement('style');
  style.id = 'vx-css'; style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.className = 'vx'; el.id = 'vx'; el.dataset.s = 'idle';
  el.innerHTML = `
    <div class="vx-pill" id="vxPill" role="status" aria-live="polite">
      <div class="vx-vis"><span class="vx-spark">${SPARK}</span><span class="vx-wave">${'<i></i>'.repeat(BARS)}</span></div>
      <div class="vx-txt"><b id="vxTitle"></b><span id="vxSub"></span></div>
      <div class="vx-acts" id="vxActs"></div>
      <i class="vx-timer" id="vxTimer"></i>
    </div>`;
  stage.appendChild(el);
  // the voice item: a rail item at the foot, like Home and Apps (the rail's own tile, icon and label)
  const foot = document.querySelector('#rail .rail-foot');
  if (foot) {
    dotEl = document.createElement('button');
    dotEl.className = 'ri vx-rail'; dotEl.id = 'vxDot';
    dotEl.setAttribute('aria-label', 'Talk to Claude'); dotEl.setAttribute('aria-pressed', 'false');
    dotEl.innerHTML = '<span class="ri-icon">'
      + appIcon('voice')
      + `<span class="vx-rail-wave">${'<i></i>'.repeat(5)}</span><i class="vx-badge"></i></span>`
      + '<span class="ri-label">Voice</span>';
    foot.appendChild(dotEl);
  }
  return el;
}

/** The rail item's state, from the indicator's (`idle` when nothing live is happening). */
function paintDot(s: string): void {
  if (!dotEl) return;
  const listen = s === 'listening' || s === 'attentive';
  dotEl.classList.toggle('wake', s === 'idle' && wakeOn);
  dotEl.classList.toggle('listen', listen);
  dotEl.classList.toggle('speak', s === 'speaking');
  dotEl.classList.toggle('think', s === 'thinking' || s === 'ask');
  dotEl.setAttribute('aria-pressed', String(listen));
  if (!listen) dotEl.style.removeProperty('--lvl');
}

const q = (id: string) => root!.querySelector<HTMLElement>(`#${id}`)!;

// ---------- painting ----------
function view(): { s: string; title: string; sub: string; actions: VoiceAction[] } | null {
  if (live) {
    switch (live.kind) {
      case 'attentive': return { s: 'attentive', title: 'Listening…', sub: HINT, actions: [] };
      case 'listening': return { s: 'listening', title: live.text || (live.followUp ? 'Anything else?' : 'Listening…'),
        sub: live.text ? 'Pause when you’re done' : live.followUp ? 'Just answer, or stay quiet to finish' : HINT, actions: [] };
      case 'heard': return { s: 'heard', title: live.text, sub: '', actions: [] };
      case 'speaking': return { s: 'speaking', title: live.text, sub: 'Tap to stop · or just start talking', actions: [] };
      case 'notice': return { s: 'notice', title: live.title, sub: live.sub, actions: [] };
    }
  }
  if (base.kind === 'thinking') {
    // with a tap action (Claude's app: open the session), say so in the subtitle, after whatever the app put there
    const sub = base.sub || '';
    return { s: 'thinking', title: base.title || 'Thinking…', actions: [],
      sub: base.onTap ? (sub ? `${sub} · Tap to open` : 'Tap to open') : sub };
  }
  if (base.kind === 'ask') return { s: 'ask', title: base.title, sub: base.sub || '', actions: base.actions };
  return null;
}

/** The "what can I say" line while it listens (the full list is in Settings > Voice). */
const HINT = 'Try “what’s the weather?” or “set a timer”';

let lastActs = '';
function paint(): void {
  if (!root) return;
  const v = view();
  root.classList.toggle('pill-on', !!v);
  paintDot(v ? v.s : 'idle');
  if (!v) { root.dataset.s = 'idle'; markMics(false); return; }
  root.dataset.s = v.s;
  q('vxTitle').textContent = v.title;
  q('vxSub').textContent = v.sub;
  const key = v.actions.map(a => a.label).join('|');
  if (key !== lastActs) {
    lastActs = key;
    const acts = q('vxActs');
    acts.innerHTML = '';
    for (const a of v.actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.primary) b.className = 'primary';
      b.addEventListener('click', e => { e.stopPropagation(); a.run(); });
      acts.appendChild(b);
    }
  }
  markMics(v.s === 'listening' || v.s === 'attentive');
  if (v.s === 'listening' || v.s === 'speaking') startWave();
}

function markMics(on: boolean): void {
  document.querySelectorAll<HTMLElement>('#svMic, [data-voice-mic]').forEach(m => m.classList.toggle('voice-live', on));
}

function setLive(l: Live | null, ms = 0): void {
  live = l;
  clearTimeout(liveTimer);
  if (l && ms) liveTimer = window.setTimeout(() => { if (live === l) { live = null; paint(); } }, ms);
  if (!l || l.kind !== 'listening' || !l.followUp || l.text) root?.classList.remove('timing');
  paint();
}

/** The follow-up line: runs down over the listening window, and goes once you start talking. */
function runTimer(ms: number): void {
  const t = q('vxTimer');
  root!.classList.add('timing');
  t.style.transition = 'none'; t.style.transform = 'scaleX(1)';
  void t.offsetWidth;
  t.style.transition = `transform ${ms}ms linear`; t.style.transform = 'scaleX(0)';
}

// ---------- the waveform ----------
let waving = false;
function startWave(): void {
  if (waving) return;
  waving = true;
  const bars = [...root!.querySelectorAll<HTMLElement>('.vx-wave i')];
  const shape = bars.map((_, i) => 1 - Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2) * .55);   // taller in the middle
  const frame = (t: number) => {
    const s = root!.dataset.s;
    if (s !== 'listening' && s !== 'speaking') { waving = false; bars.forEach(b => { b.style.transform = 'scaleY(.12)'; }); dotEl?.style.setProperty('--lvl', '0'); return; }
    if (s === 'listening') {
      shown += (level - shown) * (level > shown ? .45 : .12);   // quick up, slow down
      level *= .92;
      dotEl?.style.setProperty('--lvl', Math.min(1, shown).toFixed(3));   // the rail's ring follows the mic
      bars.forEach((b, i) => {
        const jitter = .85 + .15 * Math.sin(t / 150 + i * 1.7);   // slow, small: calm rather than flickering
        b.style.transform = `scaleY(${Math.max(.12, Math.min(1, shown * shape[i] * jitter * 1.6))})`;
      });
    } else {   // speaking: a calm, voice-like ripple
      bars.forEach((b, i) => {
        const v = .35 + .3 * Math.sin(t / 220 + i * .9) * Math.sin(t / 520 + i * .35) + .15 * Math.sin(t / 130 + i * 2.1);
        b.style.transform = `scaleY(${Math.max(.12, Math.min(1, Math.abs(v) * shape[i] * 1.3))})`;
      });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---------- tablet events ----------
function onEvent(e: VoiceEvent): void {
  switch (e.type) {
    case 'wake':
      wakeScreen();
      level = 0;
      setLive({ kind: 'attentive' });
      break;
    case 'bargein':
      setLive({ kind: 'listening', text: '', followUp: 0 });
      break;
    case 'state':
      if (e.mode === 'listening') {
        const fu = pendingFollowUp; pendingFollowUp = 0;
        if (live?.kind !== 'attentive' && live?.kind !== 'listening') { setLive({ kind: 'listening', text: '', followUp: fu }); if (fu) runTimer(fu); }
        else if (live?.kind === 'listening' && fu) { live.followUp = fu; runTimer(fu); paint(); }
      } else if (e.mode === 'wake' || e.mode === 'off') {
        if (e.mode === 'wake') wakeOn = true;
        else { try { wakeOn = !!voice.state()?.wake; } catch { wakeOn = false; } }
        if (live?.kind === 'attentive' || live?.kind === 'listening') setLive(null);
        else paint();
      }
      break;
    case 'level':
      level = Math.max(level, e.v);
      if (live?.kind === 'attentive' && e.v > .18) setLive({ kind: 'listening', text: '', followUp: 0 });
      break;
    case 'retry':   // it heard something that isn't a request ("a quad"): say so, and keep listening
      setLive({ kind: 'listening', text: '', followUp: 0 });
      q('vxTitle').textContent = 'Didn’t catch that';
      q('vxSub').textContent = 'Try again, I’m listening';
      break;
    case 'partial':
      setLive({ kind: 'listening', text: e.text.length > 90 ? '…' + e.text.slice(-88) : e.text, followUp: 0 });
      break;
    case 'final':
      setLive({ kind: 'heard', text: e.text.length > 120 ? e.text.slice(0, 118) + '…' : e.text }, 1800);
      break;
    case 'timeout': {
      const wasFollowUp = live?.kind === 'listening' && live.followUp > 0;
      if (wasFollowUp) setLive(null);
      else setLive({ kind: 'notice', title: 'Didn’t catch that', sub: 'Say “Hey Claude” and try again' }, 2800);
      break;
    }
    case 'cancel':
      setLive(null);
      break;
    case 'speaking':
      if (e.id.startsWith('critter-')) break;   // the critter's own line: its bubble shows it, no pill
      setLive({ kind: 'speaking', text: spoken.get(e.id) || 'Speaking…' });
      break;
    case 'spoken':
      spoken.delete(e.id);
      if (live?.kind === 'speaking') setLive(null);
      break;
    case 'stop':
      setLive({ kind: 'notice', title: 'Stopped', sub: '' }, 1400);
      break;
    case 'error':
      console.warn('voice:', e.code, e.message);   // the tablet's own words are for the log; the screen gets a plain line
      setLive({ kind: 'notice', title: 'Voice isn’t working right now', sub: plainError(e.code, e.message) }, 4000);
      break;
  }
}

// the tablet's failure codes (device.ts VoiceReason) as plain ClaudeOS lines, for the screen
const REASON_LINE: Record<VoiceReason, string> = {
  no_mic: 'Check that ClaudeOS can use the microphone',
  mic_busy: 'Another app is using the microphone. Try again in a moment',
  no_pack: 'The speech pack for voice isn’t on this tablet yet',
  no_voice: 'Pick another voice in Settings › Voice',
  tts_failed: 'ClaudeOS couldn’t speak just now. Try again in a moment',
  stt_failed: 'ClaudeOS couldn’t make out that. Try again in a moment',
  network: 'This voice needs an internet connection',
  unknown: 'Try again in a moment',
};
// the same reasons, short, for the rail item's label: "Voice is off: <this>"
const OFF_WORDS: Record<VoiceReason, string> = {
  no_mic: 'no microphone access', mic_busy: 'the microphone is in use', no_pack: 'the speech pack is missing',
  no_voice: 'no voice is installed', tts_failed: 'speaking isn’t working', stt_failed: 'listening isn’t working',
  network: 'no internet connection', unknown: 'unknown reason',
};

/** A plain line for a failure: the tablet's code when it gave one, else the old text heuristics on its message. */
function plainError(code: string | undefined, m: string): string {
  if (code && Object.prototype.hasOwnProperty.call(REASON_LINE, code)) return REASON_LINE[code as VoiceReason];
  if (/install/i.test(m)) return 'Pick another voice in Settings › Voice';
  if (/microphone|permission/i.test(m)) return 'Check that ClaudeOS can use the microphone';
  return 'Try again in a moment';
}

/** The one talk action: the rail's Voice item and the mic buttons all behave the same way.
 *  Listening → stop. Speaking → stop it, and listen. Otherwise → listen. */
function tapTalk(): void {
  const s = root?.dataset.s;
  if (s === 'listening' || s === 'attentive') { try { voice.cancel(); } catch { /* ignore */ } setLive(null); return; }
  if (s === 'speaking') { try { voice.stopSpeaking(); } catch { /* ignore */ } }
  talkHandler();
}

function onTap(): void {
  const s = root?.dataset.s;
  if (s === 'speaking') { try { voice.stopSpeaking(); } catch { /* ignore */ } return; }
  if (s === 'listening' || s === 'attentive') { try { voice.cancel(); } catch { /* ignore */ } setLive(null); return; }
  if (s === 'notice' || s === 'heard') { setLive(null); return; }
  if (base.kind === 'thinking') base.onTap?.();
}

// ---------- API ----------
export const voiceUi = {
  /** Put the indicator on the stage (once). Does nothing off the tablet. */
  init(): void {
    if (root || !voice.available) return;
    const stage = document.getElementById('stage');
    if (!stage) return;
    root = build(stage);
    q('vxPill').addEventListener('click', onTap);
    dotEl?.addEventListener('click', e => { e.stopPropagation(); tapTalk(); });
    // the rail item is dimmed while the tablet's voice is off, and its label says why
    const off = voiceOffReason();
    if (off && dotEl) {
      dotEl.classList.add('off');
      const why = `Voice is off: ${OFF_WORDS[off]}`;
      dotEl.setAttribute('aria-label', why); dotEl.title = why;
    }
    // tap-to-talk buttons anywhere, now or later ([data-voice-mic]; the session composer's #svMic has its own hook)
    document.addEventListener('click', e => {
      const m = (e.target as Element).closest?.('[data-voice-mic]');
      if (!m) return;
      e.preventDefault();
      tapTalk();
    }, true);
    voice.on(onEvent);
    try { wakeOn = !!voice.state()?.wake; } catch { wakeOn = false; }
    paint();
  },
  /** What shows when nothing live is happening: idle, Claude thinking, or a question with buttons. */
  setBase(b: VoiceBase): void { base = b; lastActs = '\u0000'; paint(); },   // new buttons, even if labelled the same
  /** A short message ("Can't reach your PC"…). */
  notice(title: string, sub = '', ms = 2600): void { setLive({ kind: 'notice', title, sub }, ms); },
  /** Say something aloud and show it while it's said. */
  say(text: string, id: string): void {
    spoken.set(id, text.length > 160 ? text.slice(0, 158) + '…' : text);
    try { voice.speak(text, id); } catch { spoken.delete(id); }
  },
  /** Listen for an answer without the wake word, showing the time left. */
  followUp(ms: number): void {
    pendingFollowUp = ms;
    try { voice.listen(ms); } catch { pendingFollowUp = 0; }
  },
  /** The plain line for a failure code from the tablet (voice.ts uses it for a refused listen). */
  reasonLine(code?: string): string { return plainError(code, ''); },
  /** Listen again without the wake word, as a plain listen (a retry after a word that wasn't a request: no "Anything else?"). */
  listenAgain(ms: number): void {
    pendingFollowUp = 0;
    try { voice.listen(ms); } catch { /* no mic: the next tap says so */ }
  },
  /** What tapping the idle spark or a mic button does (default: listen). */
  onTalk(fn: () => void): void { talkHandler = fn; },
  /** Is it listening to you right now (so a mic button can act as a toggle)? */
  isListening(): boolean { const s = root?.dataset.s; return s === 'listening' || s === 'attentive'; },
  /** Is Claude speaking aloud right now (the status cluster's speaker)? The critter's own line doesn't count. */
  isSpeaking(): boolean { return root?.dataset.s === 'speaking'; },
  /** Stop listening (a mic button tapped again). */
  cancelListening(): void { try { voice.cancel(); } catch { /* ignore */ } setLive(null); },
  /** Re-read whether the wake word is on (e.g. after Settings changed it). */
  refresh(): void { try { wakeOn = !!voice.state()?.wake; } catch { /* ignore */ } paint(); },
};
