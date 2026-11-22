// The first-run welcome: a few short, skippable steps the first time ClaudeOS starts on the tablet, and again from
// Settings > About ("Show welcome again"). Finishing or skipping is kept on the PC (profile.json), so it shows once
// per ClaudeOS install, not once per browser:
//   GET  /api/settings/welcome   {done}: false until the welcome has been finished or skipped
//   POST /api/settings/welcome   {done}: true when finished or skipped (false brings it back)
// Steps: Welcome, You (what Claude calls you), Look (theme), Network (only when offline), Voice (only when the tablet
// has voice), Done (tips). Each step can be skipped, and "Skip setup" is always there. The flow starts only once the
// app has mounted (main.web.ts), never while the PIN lock is up. ?welcome=1 shows it on any screen (for the mock tablet).
import { esc, getJson, params, postJson, report } from './dom.ts';
import { device, onTablet, voice } from './device.ts';
import type { WifiNet, WifiState } from './device.ts';
import { Keyboard } from './keyboard.ts';
import { lockShowing } from './lock.ts';
import { applyProfile, profile } from './profile.ts';
import type { Profile } from './profile.ts';
import { onBack, openApp } from './system.ts';
import { setThemeMode, themeMode } from './theme.ts';
import type { ThemeMode } from './theme.ts';

type Step = 'welcome' | 'you' | 'look' | 'network' | 'voice' | 'done';

const NAME_MAX = 30;   // the same limit as Settings' "what Claude should call you" (apps/settings/api.ts)
const JOIN_WAIT_MS = 25e3;
const LOOKS: { id: ThemeMode; name: string; note: string }[] = [
  { id: 'light', name: 'Light', note: 'Warm paper, dark ink' },
  { id: 'dark', name: 'Dark', note: 'Dark ink, warm light' },
  { id: 'time', name: 'Follow time of day', note: 'Dark from 7 pm to 7 am' },
];
const NEXT: Record<Step, string> = { welcome: 'Get started', you: 'Continue', look: 'Continue', network: 'Continue', voice: 'Continue', done: 'Done' };

// The critter: the same pixels as the Home app's (apps/home/view.html) and the start screen (public/index.html).
const CRITTER = `<svg class="wel-critter" viewBox="0 0 14 11" shape-rendering="crispEdges" aria-hidden="true">
  <g fill="var(--clay-deep)"><rect x="3" y="7" width="1" height="2.6"/><rect x="5" y="7" width="1" height="2.6"/><rect x="8" y="7" width="1" height="2.6"/><rect x="10" y="7" width="1" height="2.6"/></g>
  <rect x="1" y="4" width="1.2" height="2" fill="var(--clay)"/><rect x="11.8" y="4" width="1.2" height="2" fill="var(--clay)"/>
  <rect x="2" y="1.5" width="10" height="6" fill="var(--clay)"/>
  <g fill="var(--eye)"><rect x="4" y="3" width="1" height="2"/><rect x="9" y="3" width="1" height="2"/></g>
  <g fill="var(--blush)"><rect x="3" y="5.3" width="1.2" height=".6"/><rect x="9.8" y="5.3" width="1.2" height=".6"/></g>
</svg>`;

let root: HTMLElement | null = null;
let steps: Step[] = [];
let at = 0;
let fromSettings = false;      // opened from Settings > About: Done stays on Settings
let nickDraft = '';
let nickBefore = '';
let wakeOn = false;
let wakeNote = '';
let joining = '';
let joinedAt = 0;
let joinError = '';
let netPoll: number | undefined;
let lockTries = 0;
let unBack: (() => void) | undefined;   // the welcome's Back handler, on the stack while the welcome is up

const $ = <T extends Element = HTMLElement>(sel: string): T => root!.querySelector<T>(sel)!;
const showing = (): boolean => !!root && !root.hidden;

function ensureRoot(): HTMLElement {
  if (!root) {
    root = document.createElement('div');
    root.id = 'welcome';
    root.className = 'wel';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Welcome to ClaudeOS');
    root.addEventListener('click', onClick);
    document.getElementById('stage')!.appendChild(root);   // inside the stage, so it scales with it; under the keyboard
  }
  return root;
}

// ---------- the steps ----------

/** Whether the tablet is already online: connected to a Wi-Fi network (the Network step is then skipped). */
function online(): boolean {
  try { return navigator.onLine && !!device.wifi().ssid; } catch { return false; }
}

/** The tablet has voice, and its state can be read. Older tablet apps have none, so the Voice step is left out. */
function voiceReady(): boolean {
  if (!voice.available) return false;
  try { return voice.state() != null; } catch { return false; }
}

function wakeNow(): boolean {
  try { return !!voice.state()?.wake; } catch { return false; }
}

/** Start the flow now: from Settings, or the first start. Does nothing when it is already up. */
export function showWelcome(again = false): void {
  if (showing()) return;
  ensureRoot();
  const list: Step[] = ['welcome', 'you', 'look'];
  if (onTablet && !online()) list.push('network');
  if (voiceReady()) list.push('voice');
  list.push('done');
  steps = list;
  at = 0;
  fromSettings = again;
  nickDraft = profile().nickname;
  wakeOn = wakeNow();
  wakeNote = '';
  if (!unBack) unBack = onBack(welcomeBack, 100);   // above everything: the welcome is a full-screen step
  go(true);
}

/** On first start (after the app has mounted): show the welcome if the PC has not recorded it as finished. */
export async function maybeWelcome(): Promise<void> {
  if (params.get('welcome') === '1') { whenUnlocked(() => showWelcome(false)); return; }
  if (!onTablet) return;
  let r: { done?: boolean } | null = null;
  try { r = await getJson<{ done?: boolean }>('/api/settings/welcome'); } catch { return; }   // PC unreachable, or no route yet
  if (r && r.done === false) whenUnlocked(() => showWelcome(false));
}

/** Wait for the PIN lock to go (it can be up on a wake); the welcome never shows over it. */
function whenUnlocked(fn: () => void): void {
  if (lockShowing()) {
    if (lockTries++ < 90) setTimeout(() => whenUnlocked(fn), 2000);
    return;
  }
  fn();
}

function go(stepChanged: boolean): void {
  const r = ensureRoot();
  r.hidden = false;
  if (stepChanged || !r.querySelector('#welBody')) r.innerHTML = frame(steps[at]);
  else paintBody();
  if (steps[at] === 'network') startNetPoll();
}

function frame(s: Step): string {
  const last = s === 'done';
  return `
    <div class="wel-top">
      ${at > 0 ? '<button class="wel-link hit" data-act="back">Back</button>' : '<span></span>'}
      ${last ? '<span></span>' : '<button class="wel-link hit" data-act="skipall">Skip setup</button>'}
    </div>
    <div class="wel-body wel-in" id="welBody">${body(s)}</div>
    <div class="wel-foot">
      <button class="wel-btn hit" data-act="next">${last && !fromSettings ? 'Open ClaudeOS' : NEXT[s]}</button>
      ${s === 'welcome' || last ? '' : '<button class="wel-link hit" data-act="skip">Skip this step</button>'}
      <div class="wel-dots" aria-hidden="true">${steps.map((_, i) => `<i class="${i === at ? 'on' : ''}"></i>`).join('')}</div>
    </div>`;
}

/** Repaint only the step's body (no entrance animation): for taps and live updates inside a step. */
function paintBody(): void {
  if (!showing()) return;
  const b = root!.querySelector<HTMLElement>('#welBody');
  if (b) b.innerHTML = body(steps[at]);
}

function body(s: Step): string {
  switch (s) {
    case 'welcome':
      return `<div class="wel-hero">${CRITTER}<p class="wel-say">hi there!</p></div>
        <h1 class="wel-h1">Welcome to ClaudeOS</h1>
        <p class="wel-lede">A calm home for Claude on this tablet. Setup takes about a minute, and any part of it can be skipped.</p>`;
    case 'you':
      return `<div class="wel-kicker">You</div>
        <h2 class="wel-h2">What should Claude call you?</h2>
        <p class="wel-lede">Your first name is plenty. You can change it in Settings any time.</p>
        <button class="wel-field hit" data-act="name" aria-label="What Claude should call you">${nickDraft ? esc(nickDraft) : '<span class="ph">Tap to type</span>'}</button>`;
    case 'look': {
      const mode = themeMode();
      return `<div class="wel-kicker">Look</div>
        <h2 class="wel-h2">How should ClaudeOS look?</h2>
        <p class="wel-lede">Tap one to see it. You can change it any time in Settings.</p>
        <div class="wel-looks" role="radiogroup">${LOOKS.map(l => `
          <button class="wel-look hit${mode === l.id ? ' on' : ''}" role="radio" aria-checked="${mode === l.id}" data-look="${l.id}">
            <span class="wel-swatch ${l.id}"><i></i><i></i></span><b>${l.name}</b><small>${l.note}</small>
          </button>`).join('')}</div>`;
    }
    case 'network':
      return `<div class="wel-kicker">Network</div>
        <h2 class="wel-h2">Join Wi-Fi</h2>
        <p class="wel-lede">ClaudeOS needs Wi-Fi to reach your PC.</p>
        ${netBody()}`;
    case 'voice':
      return `<div class="wel-kicker">Voice</div>
        <h2 class="wel-h2">Say “Hey Claude” to talk</h2>
        <p class="wel-lede">It listens on this tablet only. Nothing is recorded or sent until you say “Hey Claude”.</p>
        <div class="wel-row">
          <div><b>“Hey Claude”</b><span>${esc(wakeNote || (wakeOn ? 'On. Say it any time.' : 'Off. You can turn it on later in Settings.'))}</span></div>
          <button class="wel-switch hit" role="switch" aria-label="Hey Claude" aria-checked="${wakeOn}" data-act="wake"><i></i></button>
        </div>`;
    case 'done':
      return `<div class="wel-hero">${CRITTER}<p class="wel-say">all set!</p></div>
        <h1 class="wel-h1">You’re all set</h1>
        <ul class="wel-tips">
          <li><b>Swipe down from the top</b><span>Quick controls: brightness, volume, Wi-Fi and notifications.</span></li>
          <li><b>Swipe up from the bottom</b><span>See every open app. Flick one up to close it.</span></li>
          <li><b>Tap a message</b><span>In Claude, for copy, pin and more.</span></li>
        </ul>`;
  }
}

// ---------- Wi-Fi (the same bridge calls as Settings > Network) ----------

function netBody(): string {
  let w: WifiState;
  try { w = device.wifi(); } catch { return '<p class="wel-note">Wi-Fi can’t be reached from here. You can set it up later in Settings.</p>'; }
  if (!w.enabled) return '<button class="wel-btn hit" data-act="wifi-on">Turn Wi-Fi on</button>';
  let nets: WifiNet[] = [];
  try { nets = device.wifiNetworks(); } catch { /* shown as nothing found */ }
  const list = nets.filter(n => n.ssid && !n.current).sort((a, b) => Number(b.saved) - Number(a.saved) || b.bars - a.bars);
  const rows = list.map(n => {
    const sub = n.ssid === joining ? 'Joining…' : n.enterprise ? 'Work network, set up in Settings' : n.saved ? 'Saved' : n.secure ? 'Secured' : 'Open';
    return `<button class="wel-net hit" data-join="${esc(n.ssid)}"><div><b>${esc(n.ssid)}</b><span>${esc(sub)}</span></div></button>`;
  }).join('');
  return `${w.ssid ? `<p class="wel-conn">Connected to <b>${esc(w.ssid)}</b></p>` : ''}
    ${list.length ? `<div class="wel-nets">${rows}</div>` : '<p class="wel-note">Looking for networks…</p>'}
    ${joinError ? `<p class="wel-note wel-err">${esc(joinError)}</p>` : ''}`;
}

function onJoin(ssid: string): void {
  if (joining) return;
  let n: WifiNet | undefined;
  try { n = device.wifiNetworks().find(x => x.ssid === ssid); } catch { n = undefined; }
  if (!n) return;
  if (n.enterprise) { joinError = 'Networks that need a username are set up in Settings.'; paintBody(); return; }
  let owner = false;
  try { owner = !!device.setup()?.owner; } catch { owner = false; }
  // a new secured network asks for its password here; otherwise the tablet joins (Android's own panel may open)
  if (n.saved || !n.secure || !owner) { join(ssid); return; }
  Keyboard.open({
    placeholder: `Password for ${ssid}`, done: 'Join',
    onDone: pw => { if (pw.length < 8) return false; join(ssid, pw); },
  });
}

function join(ssid: string, pw = ''): void {
  joinError = '';
  joining = ssid;
  joinedAt = Date.now();
  try {
    const r = device.wifiConnect(ssid, pw);
    if (r.panel) { joining = ''; return; }   // Android's Wi-Fi panel opened over ClaudeOS instead
    if (!r.ok) throw new Error('refused');
  } catch {
    joining = '';
    joinError = `Couldn’t join ${ssid}. Check the password and try again.`;
  }
  paintBody();
}

function scanNow(): void {
  try { device.wifiScan(); } catch { /* scans are throttled; results still come */ }
}

function startNetPoll(): void {
  stopNetPoll();
  scanNow();
  netPoll = window.setInterval(netTick, 3000);
}
function stopNetPoll(): void {
  clearInterval(netPoll);
  netPoll = undefined;
}
function netTick(): void {
  if (!showing() || steps[at] !== 'network') { stopNetPoll(); return; }
  try { const w = device.wifi(); if (joining && w.ssid === joining) joining = ''; } catch { /* keep the list as it is */ }
  if (joining && Date.now() - joinedAt > JOIN_WAIT_MS) {
    joining = '';
    joinError = 'Couldn’t join. Check the password and try again.';
  }
  paintBody();
}

function wifiOn(): void {
  try { device.wifiEnable(true); } catch { /* the list says what's wrong */ }
  scanNow();
  paintBody();
}

// ---------- actions ----------

function onClick(e: Event): void {
  const el = (e.target as Element).closest<HTMLElement>('[data-act], [data-look], [data-join]');
  if (!el) return;
  if (el.dataset.look) { pickLook(el.dataset.look as ThemeMode); return; }
  if (el.dataset.join) { onJoin(el.dataset.join); return; }
  switch (el.dataset.act) {
    case 'next': void next(); return;
    case 'skip': void skipStep(); return;
    case 'skipall': void finish(); return;
    case 'back': back(); return;
    case 'name': editName(); return;
    case 'wake': toggleWake(); return;
    case 'wifi-on': wifiOn(); return;
  }
}

/** Leaving a step: keep what it was for (the name), stop what it runs (the Wi-Fi list), close its keyboard. */
function leave(s: Step): void {
  if (s === 'you') void saveNick();
  if (s === 'network') stopNetPoll();
  if (Keyboard.isOpen) Keyboard.close('nav');
}

function next(): Promise<void> {
  if (steps[at] === 'done') return finish();
  leave(steps[at]);
  at++;
  go(true);
  return Promise.resolve();
}

function skipStep(): Promise<void> {
  leave(steps[at]);
  if (at >= steps.length - 1) return finish();
  at++;
  go(true);
  return Promise.resolve();
}

function back(): void {
  if (at === 0) return;
  leave(steps[at]);
  at--;
  go(true);
}

/** Back (system.ts): the previous step; on the first step Back skips the setup, the same as "Skip setup". */
function welcomeBack(): boolean {
  if (!showing()) return false;
  if (at > 0) back();
  else void finish();
  return true;
}

/** Finish (or skip) the welcome: record it on the PC, close it, and land on Home (unless it was opened from Settings). */
async function finish(): Promise<void> {
  if (!root) return;
  if (Keyboard.isOpen) Keyboard.close('close');
  stopNetPoll();
  unBack?.(); unBack = undefined;   // off the Back stack once it is closed
  root.hidden = true;
  root.innerHTML = '';
  report('welcome:done');
  try { await postJson('/api/settings/welcome', { done: true }); } catch { /* offline: it may ask once more */ }
  if (!fromSettings) openApp('home');
}

function pickLook(id: ThemeMode): void {
  setThemeMode(id);
  report(`welcome:look:${id}`);
  paintBody();
}

function editName(): void {
  nickBefore = nickDraft;
  Keyboard.open({
    value: nickDraft, placeholder: 'What Claude should call you', done: 'Done', autoCap: true, max: NAME_MAX,
    onChange: t => { nickDraft = t; paintBody(); },
    onDone: t => { nickDraft = t.trim(); paintBody(); },
    onClose: reason => { if (reason === 'cancel') { nickDraft = nickBefore; paintBody(); } },
  });
}

/** Save the name to the PC (Settings → Profile's own field), only when it changed. */
async function saveNick(): Promise<void> {
  const v = nickDraft.trim();
  if (!v || v === profile().nickname) return;
  try { applyProfile(await postJson<Profile>('/api/settings/profile', { nickname: v })); } catch { /* offline: not saved this time */ }
}

function toggleWake(): void {
  const want = !wakeOn;
  wakeNote = '';
  try {
    const r = voice.setWake(want);
    if (r.ok || r.asking) {
      wakeOn = want;
      if (r.asking) wakeNote = 'Allow the microphone when Android asks.';
    } else wakeNote = 'Couldn’t change that. You can try again in Settings.';
  } catch {
    wakeNote = 'Couldn’t change that. You can try again in Settings.';
  }
  report(`welcome:wake:${wakeOn ? 'on' : 'off'}`);
  paintBody();
}
