// The Claude app: plan limits, live sessions and the critter's status line.
import { esc, getJson, params, report } from '../../../core/web/dom.ts';
import { startBrowserRelay } from './browser-relay.ts';
import { clock, fmt, prettyModel, shortAge, untilText, whenText } from '../../../core/web/format.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { toggleTheme } from '../../../core/web/theme.ts';
import type { LimitWindow, LiveSession, Usage } from '../api.ts';
import { manifest } from '../manifest.ts';
import { callOver, celebrate, clearCall, critterScreen, flag, getMood, initCritter, pendingCall, setMood, type Mood } from './critter.ts';
import { initMug } from './mug.ts';
import { closeSession, currentSession, initReply, nudgeChip, onUsage, openNew, openSession } from './reply.ts';
import { initVoice, tapToStop } from './voice.ts';
import { pace, toolWord } from './words.ts';
import { subagentsWorking } from './sessions/sidebar-groups.ts';
import { loadModels, modelChoices, newPref, setNewPref, setVoicePref, voicePref } from './sessions/controls.ts';
import { appSettingsChanged, registerAppSettings } from '../../../core/web/app-settings.ts';
import { device } from '../../../core/web/device.ts';
import { NATIVE_MODELS, nativeBusy, nativeCliVersion, nativeClear, nativeLimits, nativeModel, nativeOn, setNativeModel, setNativeOn } from './native.ts';
import { limitName, limitState } from './native-stream.ts';

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);

const DEMO = params.has('demo');
const FORCE_MOOD = params.get('mood') as Mood | null;
const SESSION_MS = 5 * 3600e3, WEEK_MS = 7 * 24 * 3600e3;
const VERBS = ['Pondering', 'Noodling', 'Brewing', 'Tinkering', 'Percolating', 'Musing', 'Crafting', 'Synthesizing', 'Simmering', 'Puzzling'];

let data: Usage | null = null;
let asking = false;
let verb = 0, prevLeft: number | null = null, prevYours = 0;
let pcDown = false;   // the last usage read failed: the pill says Offline, even over the old data

// ---------- limits ----------
function paintLimit(p: 's' | 'w', lim: LimitWindow | undefined, windowMs: number): number | null {
  const used = lim && lim.used != null ? Math.min(100, Math.max(0, lim.used)) : null;
  const bar = $(`${p}Bar`), fill = bar.querySelector<HTMLElement>('i')!, marker = bar.querySelector<HTMLElement>('.now')!;
  if (used == null || !lim) {
    $(`${p}Pct`).className = 'big num empty'; $(`${p}Pct`).innerHTML = '–';
    $(`${p}Sub`).textContent = data && data.limits.status !== 'ok' ? 'Limits not connected yet' : '–';
    $(`${p}Pace`).textContent = ''; fill.style.width = '0'; marker.style.display = 'none';
    $(`${p}Used`).textContent = ''; $(`${p}Detail`).innerHTML = '';
    return null;
  }
  const left = 100 - used, pc = pace(lim, windowMs);
  const at = lim.resets_at ? new Date(lim.resets_at) : null;
  $(`${p}Pct`).className = 'big num';
  $(`${p}Pct`).innerHTML = `${Math.round(left)}<small>% left</small>`;
  const soon = at && +at - Date.now() < 18 * 3600e3;   // within 18 hours, the time alone is clear enough
  $(`${p}Sub`).textContent = at ? `Resets ${soon ? clock(at) : whenText(at)} · in ${untilText(+at - Date.now())}` : 'Starts with your next message';
  $(`${p}Pace`).className = `pacenote ${pc ? pc.cls : ''}`;
  $(`${p}Pace`).textContent = pc ? pc.long : '';
  fill.style.width = `${used}%`;
  $(`${p}Used`).textContent = `${Math.round(used)}% used`;
  marker.style.display = pc ? '' : 'none';
  if (pc) marker.style.left = `${(pc.frac * 100).toFixed(1)}%`;

  const L = data!.limits;
  const extra: [string, string][] = p !== 'w' ? [] : [
    ...L.list.filter(l => l.kind === 'weekly_scoped' && l.model).map(l => [`${l.model} only`, `${100 - Math.round(l.percent)}% left`] as [string, string]),
    ...(L.breakdown.length ? [['Where it went', L.breakdown.slice(0, 3).map(b => `${b.name.replace(/^Claude /, '')} ${b.percent}%`).join(' · ')] as [string, string]] : []),
  ];
  const rows: [string, string][] = [
    ['Used', `${Math.round(used)}%`],
    ['Time gone', `${Math.round((pc ? pc.frac : 0) * 100)}% of the window`],
    ['Resets', at ? at.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '–'],
    ...extra,
  ];
  $(`${p}Detail`).innerHTML = rows.map(([k, v]) => `<div><span>${esc(k)}</span><b class="num">${esc(v)}</b></div>`).join('');
  return left;
}

/** One plain sentence, written like the anthropic.com headline: [bold lead, grey serif continuation]. */
function summary(lim: Record<string, LimitWindow>): [string, string] {
  const s = lim.five_hour, w = lim.seven_day;
  if (!s && !w) return ['Plan limits aren’t connected yet.', 'Token counts come from your local logs.'];
  const sp = pace(s, SESSION_MS), wp = pace(w, WEEK_MS);
  if (sp?.short === 'Limit reached') return ['Session limit reached.', `${sp.long}.`];
  if (wp?.short === 'Limit reached') return ['Weekly limit reached.', `${wp.long}.`];
  if (sp && sp.cls !== 'good') return ['Ease up a little.', `This session ${sp.short.replace('Runs', 'runs')}.`];
  if (wp && wp.cls !== 'good') return ['Running warm this week.', `You’ll ${wp.short.replace('Runs', 'run')}.`];
  if (w?.resets_at) {
    const at = new Date(w.resets_at), tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
    const day = at.toDateString() === new Date().toDateString() ? 'today’s'
      : at.toDateString() === tmr.toDateString() ? 'tomorrow’s' : `${at.toLocaleDateString([], { weekday: 'long' })}’s`;
    return ['On track.', `You should reach ${day} reset with room to spare.`];
  }
  return ['On track.', ''];
}

// ---------- sessions ----------
function renderSessions(S: LiveSession[]): void {
  $('sessCount').textContent = S.length ? `· ${S.length} in the last 30 min` : '';
  if (!S.length) { $('sess').innerHTML = '<div class="empty">No sessions in the last 30 minutes</div>'; return; }
  const shown = S.slice(0, S.length > 3 ? 2 : 3);
  $('sess').innerHTML = shown.map(s => {
    const cls = s.state === 'thinking' || s.state === 'tool' ? 'busy' : s.state === 'waiting' ? 'yours' : '';
    const what = s.state === 'tool' ? toolWord(s.tool) : s.state === 'thinking' ? 'Thinking'
      : s.state === 'waiting' ? `Your turn · ${shortAge(s.age)}` : `Quiet · ${shortAge(s.age)}`;
    const helpers = subagentsWorking(s) || (s.subagents ? `${s.subagents} helper${s.subagents > 1 ? 's' : ''}` : null);
    const sub = [s.folder, s.branch && s.branch !== 'HEAD' ? s.branch : null, helpers]
      .filter(Boolean).join(' · ');
    const attrs = s.id ? ` data-id="${esc(s.id)}"` : '';
    return `<div class="${cls}"${attrs}><i class="dot"></i><div class="name">${esc(s.title)}<span>${esc(sub)}</span></div><div class="what">${esc(what)}${s.id ? '<span class="chev">›</span>' : ''}</div></div>`;
  }).join('') + (S.length > 3 ? `<div class="more" data-more="1"><i></i><div class="name">+${S.length - 2} more sessions</div><div class="what">See all<span class="chev">›</span></div></div>` : '');
}

// ---------- calling you over when a session starts waiting ----------
const waiting = new Map<string, { since: number; calls: number; lastCall: number }>();
let primed = false;   // don't call on page load for sessions that were already waiting
const CALL_LINES = [(t: string) => `${t} needs you.`, (t: string) => `Your turn on ${t}.`, (t: string) => `${t} is waiting for you`];
const shortTitle = (t: string) => (t.length > 24 ? t.slice(0, 23) + '…' : t);

function callWaiting(yours: LiveSession[]): void {
  const now = Date.now();
  const ids = new Set(yours.map(s => s.id).filter((x): x is string => !!x));
  for (const id of [...waiting.keys()]) if (!ids.has(id)) { waiting.delete(id); if (pendingCall() === id) clearCall(); }
  for (const s of yours) {
    if (!s.id || s.id === currentSession()) continue;   // you're already looking at it
    let w = waiting.get(s.id);
    if (!w) { w = { since: now, calls: primed ? 0 : 3, lastCall: 0 }; waiting.set(s.id, w); }
    // call once straight away, then twice more, two minutes apart, while it's still waiting
    if (w.calls >= 3 || now - w.lastCall < 120e3) continue;
    const first = w.calls === 0;
    w.calls++; w.lastCall = now;
    if (first) ctx.requestAttention();
    if (!nudgeChip(s.id, s.title)) callOver(CALL_LINES[(w.calls - 1) % CALL_LINES.length](shortTitle(s.title)), s.id);
    break;   // one at a time
  }
  primed = true;
}
// ---------- every second ----------
function tick(): void {
  const now = new Date();
  if (!data) { setMood(FORCE_MOOD || 'asleep'); return; }

  const L = data.limits, lim = L.limits || {};
  const sLeft = paintLimit('s', lim.five_hour, SESSION_MS);
  paintLimit('w', lim.seven_day, WEEK_MS);
  const [lead, rest] = summary(lim);
  $('summary').innerHTML = `${esc(lead)}${rest ? ` <em>${esc(rest)}</em>` : ''}`;

  const pill = $('pill'), pillText = $('pillText');
  const asOf = L.updated ? clock(new Date(L.updated)) : null;
  if (L.status === 'ok' && !L.error) { pill.className = 'live ok'; pillText.textContent = DEMO ? 'Demo data' : 'Live'; }
  else if (L.status === 'ok') { pill.className = 'live'; pillText.textContent = asOf ? `As of ${asOf}` : 'Last known'; }
  else if (L.status === 'no_token') { pill.className = 'live'; pillText.textContent = 'Limits not connected'; }
  else if (L.status === 'expired') { pill.className = 'live bad'; pillText.textContent = 'Sign-in expired'; }
  else if (L.error?.startsWith('rate limited')) { pill.className = 'live'; pillText.textContent = 'Waiting on Anthropic'; }
  else { pill.className = 'live bad'; pillText.textContent = 'Can’t reach Anthropic'; }
  pill.hidden = L.status === 'ok' && !L.error;   // live usage needs no pill; any warning shows it
  if (pcDown) { pill.className = 'live bad'; pillText.textContent = 'Offline'; pill.hidden = false; }   // the PC stopped answering: say so over the old data

  const since = data.last_activity ? +now - Date.parse(data.last_activity) : Infinity;
  const S = data.sessions || [];
  const busy = S.filter(s => s.state === 'thinking' || s.state === 'tool');
  const yours = S.filter(s => s.state === 'waiting' && s.age < 15 * 60);
  setMood(FORCE_MOOD || (busy.length ? 'working' : yours.length || since < 10 * 60e3 ? 'idle' : 'asleep'));
  renderSessions(S);
  ctx.setBadge(yours.length > 0 || asking);
  callWaiting(yours);
  flag('hot', sLeft != null && sLeft < 10);
  if (sLeft != null && prevLeft != null && sLeft - prevLeft >= 20) celebrate();
  if (sLeft != null) prevLeft = sLeft;

  const top = busy[0] || yours[0];
  const model = top?.model ? prettyModel(top.model) : data.models[0] ? prettyModel(data.models[0][0]) : null;
  const withModel = (s: string) => s + (model ? ` · ${model}` : '');
  const ago = Number.isFinite(since) ? untilText(since) : null;
  const status = $('status'), sub = $('statusSub');
  switch (getMood()) {
    case 'working':
      status.textContent = `${VERBS[verb]}…`;
      sub.textContent = busy.length > 1 ? withModel(`${busy.length} sessions working`) : withModel(top?.state === 'tool' ? toolWord(top.tool) : 'Thinking');
      break;
    case 'idle':
      if (yours.length) {
        status.textContent = 'Your turn';
        sub.textContent = yours.length > 1 ? `${yours.length} sessions waiting for you` : `${top!.title} is waiting`;
      } else {
        status.textContent = 'Taking a break';
        sub.textContent = !ago ? ' ' : since < 6e4 ? 'Last reply just now' : `Last reply ${ago} ago`;
      }
      break;
    default:
      status.textContent = 'Resting';
      sub.textContent = ago ? `Quiet for ${ago}` : 'Nothing yet today';
  }
}

// ---------- data ----------
function demoize(d: Usage): void {
  const h = 3600e3;
  d.limits = { ...d.limits, status: 'ok', limits: {
    five_hour: { used: 38, resets_at: new Date(Date.now() + 1.6 * h).toISOString() },
    seven_day: { used: 51, resets_at: new Date(Date.now() + 98 * h).toISOString() },
  } };
  if (params.has('sessions')) {
    const base = { id: null, tokens: 0, surface: 'cli', subagents: 0, working: 0, branch: null as string | null, open: false, hub: false };
    d.sessions = [
      { ...base, title: 'Refactor checkout flow', folder: 'storefront', branch: 'feat/checkout', model: 'claude-opus-5-5', state: 'tool', tool: 'Bash', age: 4, subagents: 2, working: 1 },
      { ...base, title: 'HTML casting to Google Nest Hub', folder: 'No folder', model: 'claude-opus-5-5', state: 'waiting', tool: null, age: 180 },
      { ...base, title: 'Fix flaky upload test', folder: 'eBay Cards', branch: 'main', model: 'claude-sonnet-5-5', state: 'stalled', tool: null, age: 1500 },
    ];
  }
}

function render(d: Usage): void {
  if (DEMO) demoize(d);
  data = d;
  pcDown = false;   // a good read: the PC answers again
  asking = onUsage(d);   // a Hub reply waiting on an approval pulls the screen over
  $('tTokens').textContent = fmt(d.today.total);
  $('tReplies').textContent = d.today.messages.toLocaleString();
  $('tBurn').textContent = d.burn_per_min >= 1 ? `${fmt(d.burn_per_min)} tokens a minute right now` : '';
  const plan = params.get('plan') || (d.plan ? d.plan[0].toUpperCase() + d.plan.slice(1) : '');
  $('plan').textContent = plan ? `· ${plan}` : '';
  tick();
}

// a usage read the PC never answers gives up before the 10 s poll would run again, so the approval check keeps running
const USAGE_TIMEOUT_MS = 8e3;

let usageSeq = 0;   // each usage read takes a number; only the newest read may repaint or flip the pill
async function load(): Promise<void> {
  const seq = ++usageSeq;
  try {
    const u = await getJson<Usage>('/api/claude/usage', USAGE_TIMEOUT_MS);
    if (seq !== usageSeq) return;   // a newer read started: its answer is the one that counts
    render(u);
  } catch {
    if (seq !== usageSeq) return;
    pcDown = true;
    $('pill').className = 'live bad'; $('pillText').textContent = 'Offline'; $('pill').hidden = false;
    if (!data) {   // nothing to show yet: say why, instead of dashes and "Looking for sessions…" forever
      $('summary').innerHTML = 'Can’t reach your PC. <em>Your usage and sessions come from it. ClaudeOS keeps trying.</em>';
      // with tablet chats on, the tablet's own chat is the one thing that works without the PC
      $('sess').innerHTML = '<div class="empty">Sessions show up once your PC answers.</div>'
        + (nativeOn() ? '<button class="qr primary" id="offTablet" type="button">Chat on this tablet</button>' : '');
      if (nativeOn()) $('offTablet').addEventListener('click', () => { report('offline-tablet-chat'); void openNew(); });
    }
    tick();
  }
}

/** Settings → Apps → Claude: defaults for new sessions, and what "Hey Claude" uses. */
function registerClaudeSettings(): void {
  const models = () => { const all = modelChoices(), main = all.filter(m => m.main); return (main.length ? main : all.slice(0, 4)).map(m => ({ value: m.id, label: m.label })); };
  const SAME = { value: '', label: 'Same as above' };
  registerAppSettings({
    app: 'claude', name: 'Claude', icon: app.icon, blurb: 'Defaults for new sessions and for “Hey Claude”',
    rows: () => [
      { kind: 'switch', id: 'native', title: 'Run Claude chats on this tablet', detail: 'New chats use the Claude CLI signed in on this tablet (no tools) instead of your PC.',
        get: nativeOn, set: v => { setNativeOn(v); if (v) device.cliAuthState(true); appSettingsChanged(); } },
      ...(nativeOn() ? [
        { kind: 'info' as const, id: 'nativeCli', title: 'Chats on this tablet · CLI version', detail: 'The Claude CLI on this tablet, as the last chat reported it. It shows after the first chat on this tablet.',
          value: () => nativeCliVersion() || '–' },
        { kind: 'choice' as const, id: 'nativeModel', title: 'Chats on this tablet · model', detail: 'The model a chat on this tablet runs on. Changing it keeps the chat and applies from the next reply.',
          options: NATIVE_MODELS, get: nativeModel, set: (v: string) => setNativeModel(v) },
        { kind: 'action' as const, id: 'nativeSignin', title: 'Chats on this tablet · sign-in', detail: 'Sign in with your Claude account once. The first time, Claude Code downloads to the tablet (about 365 MB).',
          value: signinText, label: device.cliAuthState().signedIn === 1 ? 'Sign in again' : 'Sign in',
          disabled: () => device.cliAuthState().busy, run: startSignin },
        { kind: 'action' as const, id: 'nativeClear', title: 'Chats on this tablet · clear', detail: 'Removes the tablet chat from the list and the screen. The next message starts a fresh chat. The CLI keeps its session files.',
          label: 'Clear', disabled: () => nativeBusy(), run: nativeClear },
        ...nativeLimitRows(),
      ] : []),
      { kind: 'choice', id: 'newModel', title: 'New sessions · model', detail: 'What a session started from ClaudeOS runs on. You can change it per session in the composer.',
        options: [{ value: '', label: 'Default' }, ...models()], get: () => newPref('model'), set: v => setNewPref('model', v) },
      { kind: 'choice', id: 'newEffort', title: 'New sessions · effort', detail: 'How hard a session started from ClaudeOS thinks. Lower effort answers sooner.',
        options: [{ value: '', label: 'Default' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'xhigh', label: 'Extra high' }, { value: 'max', label: 'Max' }],
        get: () => newPref('effort'), set: v => setNewPref('effort', v) },
      { kind: 'choice', id: 'newMode', title: 'New sessions · permissions', detail: 'Manual asks before every change. Auto lets Claude decide what needs a yes.',
        options: [{ value: 'default', label: 'Manual' }, { value: 'auto', label: 'Auto' }, { value: 'acceptEdits', label: 'Accept edits' }, { value: 'plan', label: 'Plan' }],
        get: () => newPref('mode') || 'default', set: v => setNewPref('mode', v) },
      { kind: 'choice', id: 'voiceModel', title: '“Hey Claude” · model', detail: 'The model a spoken request starts on. Quick ones like Haiku answer fastest.',
        options: [SAME, ...models()], get: () => voicePref('model'), set: v => setVoicePref('model', v) },
      { kind: 'choice', id: 'voiceEffort', title: '“Hey Claude” · effort', detail: 'Lower effort answers sooner.',
        options: [SAME, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }],
        get: () => voicePref('effort'), set: v => setVoicePref('effort', v) },
      { kind: 'choice', id: 'voiceMode', title: '“Hey Claude” · permissions', detail: 'Approvals for spoken requests show on screen and can be answered with a clear “yes”.',
        options: [SAME, { value: 'default', label: 'Manual' }, { value: 'auto', label: 'Auto' }, { value: 'acceptEdits', label: 'Accept edits' }],
        get: () => voicePref('mode'), set: v => setVoicePref('mode', v) },
    ],
  });
  void loadModels().then(() => appSettingsChanged());
  if (nativeOn()) device.cliAuthState(true);   // the sign-in row's state (the answer repaints Settings, cli-signin.ts)
}

/** Settings rows for the plan limits the tablet CLI reported in its last chat: one per window, with the reset time. */
function nativeLimitRows(): { kind: 'info'; id: string; title: string; detail: string; value: () => string }[] {
  const limits = nativeLimits();
  if (!limits.length) {
    return [{ kind: 'info', id: 'nativeLimits', title: 'Chats on this tablet · plan limits', detail: 'Shown after your first chat on this tablet.', value: () => '–' }];
  }
  return limits.map(l => ({
    kind: 'info' as const, id: `nativeLimit-${l.type}`, title: `${limitName(l.type)} · as of your last chat`,
    detail: l.at ? `Reported by Claude on this tablet, ${whenText(new Date(l.at))}.` : 'Reported by Claude on this tablet.',
    value: () => {
      const at = l.resetsAt ? new Date(l.resetsAt) : null;
      const reset = !at ? '' : +at <= Date.now() ? ' · reset since' : ` · resets ${whenText(at)}`;
      return `${limitState(l)}${reset}`;
    },
  }));
}

/** The tablet CLI's sign-in, as the Settings row shows it. */
function signinText(): string {
  const s = device.cliAuthState();
  return s.busy ? 'Signing in…' : s.signedIn === 1 ? 'Signed in' : s.signedIn === 0 ? 'Not signed in' : '';
}

/** Settings → Apps → Claude → Sign in: the tablet downloads the CLI if needed, then opens claude.ai in the Browser. */
function startSignin(): void {
  try { device.cliSigninStart(); } catch { /* already running, or an older app build */ }
  appSettingsChanged();
}

function mount(context: AppContext): void {
  ctx = context;
  registerClaudeSettings();
  startBrowserRelay();   // Claude control: take the browser jobs sessions ask for (browser-relay.ts)
  // the Home screen's shortcuts: open a waiting session, or start a new one
  addEventListener('hub:open-session', e => { const id = (e as CustomEvent<string>).detail; if (id) openSession(id); });
  addEventListener('hub:new-session', () => ctx.$('newSess').click());
  initCritter(ctx, () => {
    if (tapToStop()) return;   // it was talking: tapping hushes it
    verb = (verb + 1) % VERBS.length;
    const target = pendingCall();
    if (target) { clearCall(); openSession(target); }   // tapped while calling you over: go there
  });
  initMug(ctx);
  ctx.header.brand.classList.add('app-hd-tap');   // the spark + "Claude" switch light/dark
  ctx.header.brand.addEventListener('click', () => toggleTheme('logo'));
  const flipTimers = new Map<string, number>();
  ctx.root.querySelectorAll<HTMLElement>('.lim').forEach(el => el.addEventListener('click', () => {
    el.classList.toggle('flipped');
    clearTimeout(flipTimers.get(el.id));
    if (el.classList.contains('flipped')) flipTimers.set(el.id, window.setTimeout(() => el.classList.remove('flipped'), 12e3));
    report(el.dataset.tap || 'limit');
  }));
  // the status verb changes every few seconds while working on screen; a slow check otherwise
  const verbLoop = (): void => {
    const on = getMood() === 'working' && ctx.isVisible() && !document.hidden;
    if (on) {
      const el = $('status');
      el.style.opacity = '0';
      setTimeout(() => { verb = (verb + 1) % VERBS.length; tick(); el.style.opacity = '1'; }, 300);
    }
    setTimeout(verbLoop, on ? 4500 : 60e3);
  };
  verbLoop();
  initReply(ctx);
  initVoice(ctx);
  // every 3 seconds while a reply runs, every 10 otherwise, on screen or off it, so an approval alerts within about
  // ten seconds wherever you are (the usage read is one small request); coming on screen loads at once (onShow)
  const loop = async () => {
    await load();
    const busy = (data?.turns || []).some(t => t.status === 'running' || t.status === 'approval');
    // a reply is running: its tool calls may need the tablet (browser, timers, notices), so keep the relay listening
    if (busy) startBrowserRelay();
    setTimeout(loop, busy ? 3e3 : 10e3);
  };
  void loop();
}

const SPARK = '<svg viewBox="-50 -50 100 100"><g fill="var(--clay)" class="spark-rays"></g></svg>';
const app: HubApp = {
  ...manifest, icon: SPARK, mount,
  onShow() { critterScreen(); void load(); startBrowserRelay(); },   // the screen is fresh the moment it comes on; the relay restarts if it went idle
  onHide() { closeSession(); critterScreen(); },
  onClose: closeSession,
};
export default app;
