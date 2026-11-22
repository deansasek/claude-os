// The critter's little life on the Claude screen: moods, idle acts, typing sparks, taps.
// Mood and act classes go on the app's own <section>, so nothing leaks into other apps.
import { SVGNS, report } from '../../../core/web/dom.ts';
import { INK, inkSay, inkedBlob, rng } from '../../../core/web/ink.ts';
import { nickname } from '../../../core/web/profile.ts';
import { critterSpeak } from '../../../core/web/system.ts';
import type { AppContext } from '../../../core/web/shell.ts';

export type Mood = 'working' | 'idle' | 'asleep';
type Act = 'look' | 'wave' | 'hop' | 'walk' | 'stretch' | 'dance' | 'glance' | 'love';

const ACTS: Act[] = ['look', 'wave', 'hop', 'walk', 'stretch', 'dance', 'glance', 'love'];
const IDLE_ACTS: [Act, number][] = [['look', 3200], ['wave', 2400], ['hop', 800], ['walk', 6000], ['stretch', 2200], ['dance', 2750]];
const GREETINGS = ['hello!', 'hi there!', 'hey!', 'beep boop', 'still here!', '♥'];

let ctx: AppContext;
let mood: Mood | null = null;
let acting = false;
let greet = 0;
let wokeTimer: number | undefined;

export const getMood = (): Mood | null => mood;

export function setMood(m: Mood): void {
  if (m === mood) return;
  mood = m;
  ctx.root.classList.remove('working', 'idle', 'asleep');
  ctx.root.classList.add(m);
  ctx.setRail({ busy: m === 'working' });
  if (ctx) syncBits();
}

/** Turn a mood-ish class (hot, woke) on or off. */
export const flag = (cls: string, on: boolean): void => { ctx.root.classList.toggle(cls, on); };

function act(name: Act, ms: number): boolean {
  if (acting) return false;
  acting = true;
  ctx.root.classList.add(`act-${name}`);
  setTimeout(() => { ctx.root.classList.remove(`act-${name}`); acting = false; }, ms);
  return true;
}

/** Cancel whatever it's doing and start an act right now. */
function actNow(name: Act, ms: number): void {
  acting = false;
  ACTS.forEach(n => ctx.root.classList.remove(`act-${n}`));
  void ctx.root.offsetWidth;
  act(name, ms);
}

const say = (text: string): void => inkSay(ctx.$('say'), text);

/** The thought bubble over the laptop, drawn by hand: ink puffs and a warm white cloud. */
function drawThoughtBubble(): void {
  const rnd = rng(11);
  const puff = (cx: number, cy: number, r: number) => {
    const p = inkedBlob(cx, cy, r, r * .92, rnd, 6, .05, [.03, .03], r * .08);
    return `<path d="${p.fill}" fill="var(--bubble)"/><path d="${p.line}" fill="none" stroke="${INK}" stroke-width=".11" stroke-linecap="round"/>`;
  };
  const cloud = inkedBlob(24.3, 6.5, 2.95, 2.15, rnd, 9, .04, [.07, .05], .07);
  ctx.$('bubble').innerHTML = puff(20.4, 10.6, .32) + puff(21.45, 9.35, .55)
    + `<g class="puff"><path d="${cloud.fill}" fill="var(--bubble)"/>`
    + `<path d="${cloud.line}" fill="none" stroke="${INK}" stroke-width=".13" stroke-linecap="round"/></g>`
    + `<g class="dots" fill="${INK}"><circle cx="23.1" cy="6.5" r=".3"/><circle cx="24.2" cy="6.5" r=".3"/><circle cx="25.3" cy="6.5" r=".3"/></g>`;
}

// the idle acts run only while the Claude screen is on (critterScreen starts and stops them)
let actT: number | undefined, bitT: number | undefined;
function scheduleAct(): void {
  clearTimeout(actT);
  actT = undefined;
  if (!ctx.isVisible()) return;
  actT = window.setTimeout(() => {
    if (mood === 'idle') { const [n, ms] = IDLE_ACTS[Math.floor(Math.random() * IDLE_ACTS.length)]; act(n, ms); }
    else if (mood === 'working') { if (Math.random() < .7) act('glance', 2200); else act('hop', 800); }
    scheduleAct();
  }, mood === 'working' ? 9000 + Math.random() * 6000 : 4500 + Math.random() * 3500);
}

/** The bits fly off the laptop only while it's working and on screen. */
function syncBits(): void {
  const on = mood === 'working' && ctx.isVisible() && !document.hidden;
  if (on && bitT === undefined) bitT = window.setInterval(spawnBit, 240);
  else if (!on && bitT !== undefined) { clearInterval(bitT); bitT = undefined; }
}

/** The Claude screen came on or went off (index.ts): start or stop the critter's own timers. */
export function critterScreen(): void {
  scheduleAct();
  syncBits();
}

/** Little bits fly off the laptop while it types. */
function spawnBit(): void {
  if (mood !== 'working' || document.hidden || !ctx.isVisible()) return;
  const r = document.createElementNS(SVGNS, 'rect');
  const s = Math.random() < .3 ? .55 : .38;
  r.setAttribute('x', String(11 + Math.random() * 8)); r.setAttribute('y', '15.3');
  r.setAttribute('width', String(s)); r.setAttribute('height', String(s));
  r.setAttribute('fill', Math.random() < .55 ? 'var(--clay)' : 'var(--t4)');
  ctx.$('bits').appendChild(r);
  const dx = (Math.random() - .5) * 3, dy = -3 - Math.random() * 3;
  r.animate([{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${dx}px,${dy}px)`, opacity: 0 }],
    { duration: 1300 + Math.random() * 600, easing: 'ease-out' }).onfinish = () => r.remove();
}

// ---------- calling you over to a session that's waiting ----------
let callTarget: string | null = null;
let callTimers: number[] = [];

/** Wave, then jump twice, and say which session needs you. Tapping the critter goes there. */
export function callOver(text: string, sessionId: string): void {
  callTimers.forEach(clearTimeout); callTimers = [];
  callTarget = sessionId;
  flag('woke', true);                 // wake up if asleep
  actNow('wave', 2400);
  say(text);
  callTimers.push(window.setTimeout(() => actNow('hop', 800), 2400));
  callTimers.push(window.setTimeout(() => actNow('hop', 800), 3300));
  callTimers.push(window.setTimeout(() => flag('woke', false), 8000));
}
export const pendingCall = (): string | null => callTarget;
export function clearCall(): void { callTarget = null; callTimers.forEach(clearTimeout); callTimers = []; }

/** A little party when the session limit resets. */
export function celebrate(): void {
  actNow('dance', 2750);
  say('fresh session!');
  const colours = ['var(--clay)', 'var(--blue)', 'var(--olive)', 'var(--t4)'];
  for (let i = 0; i < 26; i++) {
    const r = document.createElementNS(SVGNS, 'rect');
    r.setAttribute('x', '15'); r.setAttribute('y', '10'); r.setAttribute('width', '.45'); r.setAttribute('height', '.45');
    r.setAttribute('fill', colours[i % 4]);
    ctx.$('confetti').appendChild(r);
    const ang = Math.random() * Math.PI * 2, d = 4 + Math.random() * 6;
    const x = Math.cos(ang) * d, y = Math.sin(ang) * d;
    r.animate([
      { transform: 'translate(0,0) rotate(0)', opacity: 1 },
      { transform: `translate(${x}px,${y - 3}px) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: .6 },
      { transform: `translate(${x}px,${y + 4}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
    ], { duration: 1800 + Math.random() * 800, easing: 'ease-out' }).onfinish = () => r.remove();
  }
}

export function initCritter(context: AppContext, onTap: () => void): void {
  ctx = context;
  drawThoughtBubble();
  ctx.$('centre').addEventListener('click', () => {
    report('critter');
    const talk = (line: string) => { say(line); critterSpeak(line); };
    if (callTarget) { talk('this way!'); actNow('love', 1600); onTap(); return; }   // the Claude app opens the waiting session
    if (mood === 'asleep') {
      flag('woke', true);
      talk('oh! hi…');
      clearTimeout(wokeTimer);
      wokeTimer = window.setTimeout(() => flag('woke', false), 3500);
    } else {
      // now and then, by name (only when Settings → Profile has one)
      const n = nickname();
      talk(n && greet % 4 === 3 ? `hi, ${n}!` : GREETINGS[greet % GREETINGS.length]);
      greet++;
    }
    actNow('love', 1600);
    onTap();
  });
}

/** Just say a line in the speech bubble (voice.ts: what you're saying, as you say it). */
export function sayLine(text: string): void { say(text); }

/** Used by mug.ts: start an act and, optionally, say a line. */
export function react(act: 'hop' | 'wave' | 'look' | 'love' | 'dance' | 'walk', ms: number, text?: string): void {
  if (text) say(text);
  actNow(act, ms);
}
