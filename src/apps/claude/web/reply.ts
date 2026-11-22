// The Sessions screen, laid out like the Claude desktop app's Code tab:
//   left   sessions grouped by folder (sessions/sidebar.ts), "New session" at the top, Back to the dashboard
//   middle the conversation (sessions/transcript.ts), or for a new session the critter and the folder choice
//   bottom an approval / quick replies / why you can't reply, and the composer with its chips
// Replies, approvals, Stop and new sessions all go through the server (server/turns.ts), behind the
// PIN (sessions/pin.ts). Sessions open on the PC are read-only here: Claude Home never resumes them.
import { esc, getJson, report } from '../../../core/web/dom.ts';
import { browser, voice } from '../../../core/web/device.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import { markdown } from '../../../core/web/markdown.ts';
import { alertFor, notify, onBack, openApp } from '../../../core/web/system.ts';
import type { AppContext } from '../../../core/web/shell.ts';
import type { HubPermission, HubTurn, LiveSession, NewSessionResult, Project, ReplyBlock, SessionSettings, SessionView, Usage } from '../api.ts';
import { closeMenu, initControls, loadModels, newDefaults, newFolderPref, paintControls, remember, settingsFor, voiceDefaults, wantFor, type ControlsView } from './sessions/controls.ts';
import { micAvailable, micTap, onMicChange } from './sessions/mic.ts';
import { call, hidePin, initPin, withPin } from './sessions/pin.ts';
import { historyArchivedCount, historyArchivedView, loadHistory, setArchivedView } from './sessions/history.ts';
import { historyTitle, initSidebar, sidebarHtml, toggleFolder } from './sessions/sidebar.ts';
import { initManage, openSessionMenu } from './sessions/manage.ts';
import { msgKey, type MsgUi, openClips, openGroups, quickReplies, relAgo, SPARK, SPARK_RAYS, transcriptHtml } from './sessions/transcript.ts';
import { speakable } from './voice.ts';

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);

type Mode = 'closed' | 'session' | 'new';
let mode: Mode = 'closed';
let openId: string | null = null;
let view: SessionView | null = null;
// a message's row (tap a message to open it), what is being read aloud, and where the "Pinned" chip is up to
let openMsg: string | null = null;
let speakingKey: string | null = null;
let pinIdx = 0;
// the one-time hint about tapping a message: shown under the session's first Claude reply until the first tap on any message
const HINT_KEY = 'claude.hint.msgActions';
let hintSeen = false;
function hintDue(): boolean {
  if (hintSeen) return false;
  try { return localStorage.getItem(HINT_KEY) !== '1'; } catch { return true; }
}
function dismissHint(): void {
  if (hintSeen) return;
  hintSeen = true;
  try { localStorage.setItem(HINT_KEY, '1'); } catch { /* not kept: it stays gone for this visit */ }
}
const msgUi = (): MsgUi => {
  const t = view?.transcript || [], n = t.findIndex(e => e.kind === 'assistant');
  return { open: openMsg, speaking: speakingKey, voice: voice.available, now: Date.now(), hint: hintDue() && n >= 0 ? msgKey(t[n], n) : null };
};
const entryFor = (key: string) => (view?.transcript || []).find((e, n) => msgKey(e, n) === key) || null;
let poll: number | undefined;
let drawnLog = '', drawnSide = '';
let sessions: LiveSession[] = [];
// photos (the Camera and Photos apps) to send with the next message, and a draft to start the keyboard with
const MAX_PHOTOS = 3;
let photos: string[] = [];
let draft = '';
// a send that didn't go: the composer says why until you type or send again (shown in place of the placeholder)
let sendNote = '';
const SEND_NOTE: Record<string, string> = { too_many_photos: 'Too many photos for one message. Take one off.' };
const takeDraft = (): string => { const t = draft; draft = ''; return t; };
const attended = new Set<string>();                  // approvals we've already pulled the screen for
const activeTurn = (): HubTurn | null => { const t = view?.turn; return t && (t.status === 'running' || t.status === 'approval') ? t : null; };

const BLOCKED: Record<ReplyBlock, [string, string]> = {
  open_on_pc: ['Open on your PC', 'Reply in that window. ClaudeOS only answers sessions that aren’t open anywhere else.'],
  busy: ['Claude is still working', 'Wait for this session to finish its turn, then you can reply from here.'],
  too_old: ['This one has gone quiet', 'You can read it here. ClaudeOS only replies to sessions active in the last 30 minutes.'],
  no_pin: ['Set a PIN first', 'Replies from ClaudeOS need a PIN. On your PC, put 4 to 8 digits in <code>.hub-pin</code>, then come back.'],
  too_many: ['Two replies are already running', 'Give them a moment, then try again.'],
  running: ['Working on it', ''],
  not_found: ['Session not found', 'It may have ended or moved. Pick another one.'],
};

// ---------- the screen ----------
function showScreen(m: Exclude<Mode, 'closed'>): void {
  if (Keyboard.isOpen) Keyboard.close('nav');
  closeMenu();
  mode = m;
  clearInterval(poll);
  $('sv').hidden = false;
  $('sv').classList.toggle('newmode', m === 'new');
  ctx.root.classList.add('sv-open');
  $('ns').hidden = m !== 'new';
  ctx.root.querySelector<HTMLElement>('.sv-body')!.hidden = m === 'new';
  paintSidebar(true);
}

/** The sidebar's sessions: the live list, with the open session's freshest copy (kept even if it went quiet). */
function sideList(): LiveSession[] {
  const s = mode === 'session' ? view?.session : null;
  if (!s?.id) return sessions;
  return sessions.some(x => x.id === s.id) ? sessions.map(x => (x.id === s.id ? s : x)) : [s, ...sessions];
}

function paintSidebar(force = false): void {
  if (mode === 'closed') return;
  const html = sidebarHtml(sideList(), mode === 'session' ? openId : null);
  $('svNew').classList.toggle('on', mode === 'new');
  const arch = historyArchivedView(), n = historyArchivedCount();
  $('svArchText').textContent = arch ? 'Back to sessions' : `Archived${n ? ` · ${n}` : ''}`;
  $('svArch').classList.toggle('on', arch);
  if (html === drawnSide && !force) return;
  drawnSide = html;
  $('svList').innerHTML = html;
}

// ---------- the conversation ----------
function paintLog(v: SessionView, active: HubTurn | null, force = false): void {
  const log = $('svLog');
  const tail = active ? `${active.status}|${active.progress[active.progress.length - 1] || ''}` : '';
  const end = v.transcript[v.transcript.length - 1];
  const key = `${v.transcript.length}|${end?.at}|${end?.text.length}|${tail}`;
  if (key === drawnLog && !force) return;
  const fresh = !drawnLog;
  const pinned = fresh || log.scrollHeight - log.scrollTop - log.clientHeight < 80;   // keep following the end
  const grew = !fresh && key !== drawnLog;
  drawnLog = key;
  let html = v.transcript.length ? transcriptHtml(v.transcript, !!active, msgUi()) : '<div class="m-note">No messages yet.</div>';
  if (active) {
    const said = active.status === 'approval' ? 'Waiting for your OK' : (active.progress[active.progress.length - 1] || 'Working');
    html += `<div class="m-working">${SPARK}<span>${esc(said)}…</span></div>`;
  }
  const keepTop = log.scrollTop;
  log.innerHTML = `<div class="m-col">${html}</div>`;
  log.querySelectorAll('.spark-rays').forEach(g => { g.innerHTML = SPARK_RAYS; });
  if (pinned && !force) log.scrollTop = log.scrollHeight;
  else log.scrollTop = keepTop;
  if (grew && !pinned) { $('svJump').textContent = '↓ New messages'; $('svJump').hidden = false; }
  updateJump();
}

function updateJump(): void {
  const log = $('svLog');
  const away = log.scrollHeight - log.scrollTop - log.clientHeight > 200;
  if (!away) { $('svJump').hidden = true; $('svJump').textContent = '↓ Latest'; }
  else $('svJump').hidden = false;
}

// ---------- the composer ----------
interface ComposerState { ph: string; ready: boolean; folder: string; pick: boolean; ctl: ControlsView; stop: boolean; mic: boolean }
const NO_CONTROLS: ControlsView = { settings: { model: null, effort: null, mode: null }, context: null, interactive: false, show: false };

function paintComposer(c: ComposerState): void {
  $('svPh').textContent = c.ph;
  $('svComposer').classList.toggle('off', !c.ready);
  $('svFolderName').textContent = c.folder;
  $('svFolderChip').classList.toggle('strong', c.pick);
  paintControls(ctx.root, c.ctl);
  if (!c.ctl.interactive) closeMenu();
  $('svStop').hidden = !c.stop;
  // photos ready to go: the ink Send takes the mic's place (nothing typed is needed to send a photo)
  const sendable = c.ready && photos.length > 0;
  $('svSend').hidden = !sendable;
  $('svMic').hidden = !c.mic || !micAvailable() || sendable;
  paintPhotos();
}

/** The composer's placeholder while photos wait: say what the Send button will do. */
const withPhotos = (ph: string, ready: boolean): string => (ready && photos.length ? 'Add a note, or just send the photo' : ph);

/** The photos waiting to go with the next message: a thumbnail each, with × to take it off. */
function paintPhotos(): void {
  const box = $('svPhotos');
  const key = photos.join(',');
  box.hidden = photos.length === 0;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = photos.map(id => `<span class="cp-photo"><img src="/api/photos/file?id=${encodeURIComponent(id)}" alt="Photo to send" onerror="this.closest('.cp-photo').classList.add('gone')"><button class="hit hit-abs" data-rm="${esc(id)}" aria-label="Take this photo off">×</button></span>`).join('');
}

/** Re-evaluate the composer for whatever is on screen (also called when the mic hook changes). */
function repaintComposer(): void {
  if (mode === 'new') paintNewComposer();
  else if (mode === 'session') render();
}

// ---------- open / close ----------
export function openSession(id: string): void {
  const same = mode === 'session' && openId === id;
  openId = id;
  if (!same) { view = null; drawnLog = ''; openMsg = null; pinIdx = 0; sendNote = ''; }
  if ($('svNudge').dataset.id === id) $('svNudge').hidden = true;
  showScreen('session');
  if (!same) {
    $('svJump').hidden = true;
    $('svTitle').textContent = sessions.find(s => s.id === id)?.title || historyTitle(id) || 'Loading…'; $('svSub').textContent = ''; $('svLog').innerHTML = '';
    $('svApproval').hidden = true; $('svQuick').hidden = true; $('svBlocked').hidden = true;
    paintComposer({ ph: 'Loading…', ready: false, folder: '', pick: false, ctl: NO_CONTROLS, stop: false, mic: false });
  }
  void refresh();
  poll = window.setInterval(refresh, 2000);
  report('session-open');
}

/** "See all": the Sessions screen, on the session most likely to want you. */
function openList(): void {
  const listed = sessions.filter(s => s.id);
  const pick = listed.find(s => s.state === 'waiting' && !s.open) || listed.find(s => s.state === 'waiting') || listed[0];
  if (pick?.id) openSession(pick.id); else void openNew();
  report('sessions-all');
}

export function closeSession(): void {
  mode = 'closed'; openId = null; view = null; picking = false;
  photos = []; draft = ''; openMsg = null;
  closeMenu();
  $('svNudge').hidden = true;
  clearInterval(poll);
  $('sv').hidden = true; hidePin();
  ctx.root.classList.remove('sv-open');
  if (Keyboard.isOpen) Keyboard.close('nav');
}

export const isOpen = () => mode !== 'closed';
export const currentSession = (): string | null => (mode === 'session' ? openId : null);

async function refresh(): Promise<void> {
  const id = openId;
  if (mode !== 'session' || !id) return;
  let v: SessionView;
  // send the version we hold: the Hub answers "unchanged" with no transcript when nothing changed
  const have = view?.version ?? '';
  try { v = await getJson<SessionView>(`/api/claude/session?id=${encodeURIComponent(id)}&have=${encodeURIComponent(have)}`); } catch { return; }
  if (mode !== 'session' || openId !== id) return;   // switched away while it loaded
  if (v.unchanged && view) v = { ...v, transcript: view.transcript };
  view = v;
  render();
}

// ---------- painting a session ----------
function render(): void {
  if (!view || !openId || mode !== 'session') return;
  const s = view.session, t = view.turn;
  const active = t && (t.status === 'running' || t.status === 'approval') ? t : null;
  const past = !active && !!s && !s.open && !s.hub && s.age > 30 * 60;   // an old session from the history: read only
  $('svTitle').textContent = s?.title || 'Session';
  $('svSub').textContent = [s?.folder, s?.branch && s.branch !== 'HEAD' ? s.branch : null].filter(Boolean).join(' · ');

  const state = $('svState'), stateText = $('svStateText');
  // the dot means what it means everywhere: blue = your turn, clay = Claude working
  if (active) { state.className = active.status === 'approval' ? 'live wait' : 'live work'; stateText.textContent = active.status === 'approval' ? 'Needs your OK' : 'Working'; }
  else if (s?.open) { state.className = 'live'; stateText.textContent = 'Open on your PC'; }
  else if (past) { state.className = 'live'; stateText.textContent = 'Past session'; }
  else if (s?.state === 'waiting') { state.className = 'live wait'; stateText.textContent = 'Your turn'; }
  else { state.className = 'live'; stateText.textContent = !s ? 'Gone' : s.state === 'thinking' || s.state === 'tool' ? 'Working on your PC' : 'Quiet'; }

  paintSidebar();
  paintPins();

  // under the conversation: exactly one of approval / quick replies / why not (nothing while it works)
  const a = active?.approval;
  $('svApproval').hidden = !a;
  syncCountdown(!!a && mode === 'session' && !document.hidden);
  $('svQuick').hidden = !!active || !view.canReply;
  $('svBlocked').hidden = !!active || view.canReply;
  $('sv').classList.toggle('readonly', !active && !view.canReply);
  if (!active && view.canReply) {
    $('svQuick').innerHTML = quickReplies(view).map(([label, say], i) =>
      `<button class="qr${i === 0 ? ' primary' : ''}" data-say="${esc(say)}">${esc(label)}</button>`).join('');
  }
  if (a) {
    // Plan mode: Claude shows its plan and asks to start; you pick how it carries on (or keep planning)
    const plan = a.kind === 'plan';
    $('svApproval').classList.toggle('plan', plan);
    $('svAsk').textContent = plan ? 'Claude’s plan is ready. Start making changes?' : `Claude wants to ${a.summary.charAt(0).toLowerCase()}${a.summary.slice(1)}`;
    $('svDetail').hidden = plan;
    $('svPlan').hidden = !plan;
    $('svAllowEdits').hidden = !plan;
    $('svDeny').textContent = plan ? 'Keep planning' : 'Deny';
    $('svAllow').textContent = plan ? 'Yes, ask first' : 'Allow';
    if (plan) {
      const key = `${a.id}`;
      if ($('svPlan').dataset.key !== key) { $('svPlan').dataset.key = key; $('svPlan').innerHTML = markdown(a.plan || ''); $('svPlan').scrollTop = 0; }
    } else $('svDetail').textContent = a.detail;
    tickCountdown();
  }
  let blocked = '';
  if (!active && !view.canReply && view.reason) {
    const [title, body] = BLOCKED[past ? 'too_old' : view.reason] ?? BLOCKED.busy;   // an unknown reason still gets a sentence, not a crash
    blocked = title;
    $('svBlockedTitle').textContent = title;
    $('svBlockedText').innerHTML = body;   // fixed copy above, not user text
  }
  const progress = active ? (active.status === 'approval' ? 'Waiting for your OK…' : `${active.progress[active.progress.length - 1] || 'Working'}…`) : '';
  const ready = !active && view.canReply;
  paintComposer({
    ph: sendNote && ready ? sendNote : withPhotos(active ? progress : view.canReply ? 'Reply to Claude…' : s?.open ? 'Read only here · reply on your PC' : blocked || 'Can’t reply right now', ready),
    ready: !active && view.canReply,
    folder: s?.folder || '–',
    pick: false,
    // the chips: changeable when you can reply (applies from your next reply), otherwise what the log says
    ctl: { settings: settingsFor(openId, view.settings), context: view.context ?? null, interactive: !active && view.canReply, show: !!view.settings },
    stop: !!active,
    mic: !active && view.canReply,
  });
  paintLog(view, active);   // last, so it measures the conversation at its final height
}

// the approval's "denied in" countdown ticks only while an approval is on screen
let cdTimer: number | undefined;
function syncCountdown(on: boolean): void {
  if (on && cdTimer === undefined) cdTimer = window.setInterval(tickCountdown, 1000);
  else if (!on && cdTimer !== undefined) { clearInterval(cdTimer); cdTimer = undefined; }
}
function tickCountdown(): void {
  const a = mode === 'session' ? view?.turn?.approval : null;
  if (!a) { syncCountdown(false); return; }
  const left = Math.max(0, Date.parse(a.expiresAt) - Date.now()), m = Math.floor(left / 60e3), s = Math.floor(left / 1000) % 60;
  $('svCount').textContent = left > 0 ? `Denied automatically in ${m}:${String(s).padStart(2, '0')}` : 'Timing out…';
}

// ---------- a new session (like the desktop app: critter + folders in the middle, composer at the bottom) ----------
let picking = false, starting = false;
let projects: Project[] = [];
let chosen: Project | null = null;
const FOLDER_ICON = '<svg viewBox="0 0 16 16"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/></svg>';

function paintFolders(): void {
  const ago = (iso: string) => { if (!iso) return ''; const m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
  $('nsFolders').innerHTML = projects.map(p =>
    `<button class="ns-row${chosen?.id === p.id ? ' on' : ''}" data-project="${esc(p.id)}">${FOLDER_ICON}<span class="ns-name">${esc(p.name)}</span><span class="ns-when">${esc(p.lastUsed ? ago(p.lastUsed) : p.detail)}</span></button>`).join('')
    || '<div class="ns-row empty">No recent folders found.</div>';
  $('nsHint').textContent = chosen ? `Claude will work in ${chosen.detail.startsWith('~') || chosen.detail.includes('/') ? chosen.detail : chosen.name}.` : 'Pick a folder, then tell Claude what to do.';
  paintNewComposer();
}

function paintNewComposer(): void {
  const ready = !!chosen && !starting;
  paintComposer({
    ph: withPhotos(starting && chosen ? `Starting in ${chosen.name}…` : 'Describe a task or ask a question', ready),
    ready, folder: chosen ? chosen.name : 'Choose folder', pick: true,
    ctl: { settings: newDefaults(), context: null, interactive: !starting, show: true }, stop: false, mic: ready,
  });
  paintStarters(ready);
}

/** Starters for the chosen folder: short, sentence-case first messages. Tap one to fill the composer. */
const STARTERS = ['Summarise what changed today', 'Fix the failing tests', 'Explain how this folder is organised', 'Find loose ends and TODOs'];
function paintStarters(show: boolean): void {
  const box = $('nsStarts');
  const key = show && chosen ? chosen.id : '';
  box.hidden = !show;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = key ? STARTERS.map(s => `<button class="ns-start" data-start="${esc(s)}">${esc(s)}</button>`).join('') : '';
}

/** What the chips show right now (the menus check marks against this). */
function shownSettings(): SessionSettings {
  if (mode === 'session' && openId) return settingsFor(openId, view?.settings);
  return newDefaults();
}
/** A pick from the chips' menus: the new-session default, or this session's next reply. */
function pickSetting(change: Partial<SessionSettings>): void {
  if (mode === 'new') { remember(null, change); paintNewComposer(); }
  else if (mode === 'session' && openId && view?.canReply) { remember(openId, change); render(); }
}

async function openNew(): Promise<void> {
  openId = null; view = null; picking = true; starting = false;
  showScreen('new');
  $('sv').classList.remove('readonly');
  $('svTitle').textContent = 'New session';
  $('svSub').textContent = '';
  $('svState').className = 'live'; $('svStateText').textContent = 'On this computer';
  $('svNudge').hidden = true;
  $('svApproval').hidden = true; $('svQuick').hidden = true; $('svBlocked').hidden = true;
  $('nsFolders').innerHTML = '<div class="ns-row empty">Loading folders…</div>';
  paintNewComposer();
  report('new-session-open');
  try { projects = await getJson<Project[]>('/api/claude/projects'); } catch { projects = []; }
  if (!picking || mode !== 'new') return;
  // Settings → Sessions: the default folder if one is set, else the most recent folder (like the desktop app)
  const dflt = newFolderPref();
  chosen = projects.find(p => p.id === chosen?.id) || projects.find(p => p.id === dflt) || projects[0] || null;
  paintFolders();
}

function askFirstMessage(): void {
  if (!chosen || starting) return;
  const p = chosen;
  Keyboard.open({
    value: takeDraft(), placeholder: photos.length ? 'Ask about the photo, or send it as it is' : `Describe a task for ${p.name}`, autoCap: true, max: 300, done: 'Send',
    onDone: text => { if (text.trim() || photos.length) startNewSession(p, text.trim()); },
  });
}

function startNewSession(p: Project, text: string): void {
  void withPin(async () => {
    starting = true; paintNewComposer();
    $('ns').classList.add('starting');
    let r: NewSessionResult;
    try { r = await call<NewSessionResult>('new', { project: p.id, text, photoIds: photos, ...newDefaults() }); }
    finally { starting = false; $('ns').classList.remove('starting'); }
    report(r.ok ? 'new-session' : 'new-session-failed');
    if (r.ok && r.sessionId) { picking = false; photos = []; if (mode === 'new') openSession(r.sessionId); return; }
    if (mode !== 'new') return;
    paintNewComposer();
    $('nsHint').textContent = NEW_ERROR[r.error || ''] || 'It didn’t start. Try again, or start it on your PC.';
  });
}

/** What a new session that didn't start says, by reason (anything else gets the general line). */
const NEW_ERROR: Record<string, string> = {
  too_many: 'Two replies are already running. Try again in a moment.',
  no_such_folder: 'That folder isn’t there any more. Pick another one.',
  too_many_photos: 'Too many photos for one message. Take one off.',
  empty: 'Write a task, or add a photo, then send.',
};

/** Send with no text: the photos go as they are (Claude asks what it sees). */
function sendPhotos(): void {
  if (mode === 'new' && chosen && !starting) startNewSession(chosen, '');
  else if (mode === 'session') send('');
}

// ---------- calling you to another session ----------
let nudgeTimer: number | undefined;
/** While the Sessions screen is open, a small chip in the header says another session is waiting. */
export function nudgeChip(id: string, title: string): boolean {
  if ($('sv').hidden || currentSession() === id) return false;
  const chip = $('svNudge');
  chip.dataset.id = id;
  chip.innerHTML = `<i></i>${esc(title.length > 28 ? title.slice(0, 27) + '…' : title)} is waiting<span>›</span>`;
  chip.hidden = false;
  clearTimeout(nudgeTimer);
  nudgeTimer = window.setTimeout(() => { chip.hidden = true; }, 3 * 60e3);
  return true;
}

// ---------- actions (each may need the PIN) ----------
function send(text: string): void {
  if (mode !== 'session' || !openId) return;
  const id = openId;
  sendNote = '';
  $('svPh').textContent = 'Sending…';   // shown until the next refresh repaints the composer (every 2 s)
  void withPin(async () => {
    const r = await call<{ ok: boolean; error?: string; turn?: HubTurn }>('reply', { id, text, photoIds: photos, ...wantFor(id) });
    if (r.ok) { photos = []; sendNote = ''; }
    else if (view && openId === id) {
      // a reason the composer has a sentence for: it blocks the reply (BLOCKED); anything else is a note that stays until you try again
      if (r.error && r.error in BLOCKED) { view = { ...view, canReply: false, reason: r.error as ReplyBlock }; sendNote = ''; }
      else sendNote = SEND_NOTE[r.error || ''] || 'That didn’t send. Try again.';
    }
    report('reply');
    void refresh();
  });
}

function typeReply(): void {
  if (mode !== 'session' || !view?.canReply || activeTurn()) return;
  sendNote = '';
  Keyboard.open({
    value: takeDraft(), placeholder: photos.length ? 'Ask about the photo, or send it as it is' : 'Reply to Claude', autoCap: true, max: 300, done: 'Send',
    onDone: text => { if (text.trim() || photos.length) send(text.trim()); },
  });
}

/** Allow or deny. For a plan, `then` is the mode Claude carries on in (Manual unless you pick Accept edits). */
function answer(allow: boolean, then: HubPermission = 'default'): void {
  const t = view?.turn, a = t?.approval;
  if (!t || !a) return;
  void withPin(async () => {
    await call('approve', { turn: t.id, approval: a.id, allow, ...(a.kind === 'plan' ? { mode: then } : {}) });
    report(allow ? 'approve' : 'deny');
    void refresh();
  });
}

function stop(): void {
  const t = activeTurn();
  if (!t) return;
  void withPin(async () => { await call('stop', { turn: t.id }); report('stop'); void refresh(); });
}

// ---------- for voice (voice.ts) ----------
/** What the open session view knows right now (null when no session is open). */
export const viewNow = (): SessionView | null => (mode === 'session' && openId ? view : null);
/** The folder picked on the new-session screen (null when that screen isn't showing). */
export const chosenFolder = (): Project | null => (mode === 'new' ? chosen : null);
/**
 * Run an action that needs Claude Home unlocked. Resolves with its result, or with null when the
 * PIN pad had to come up first (the action then still runs once you've typed the PIN).
 */
export function unlocked<T>(fn: () => Promise<T>): Promise<T | null> {
  return new Promise(resolve => {
    let ran = false;
    void withPin(async () => { const r = await fn(); ran = true; resolve(r); }).then(() => { if (!ran) resolve(null); });
  });
}
/** POST to /api/claude/<path> with the unlock token; throws 'locked_out' when the PIN is needed. */
export const apiCall = call;
/** Voice replies use what's picked on the chips for that session (or what it already runs with). */
export function voiceReply(id: string, text: string): Promise<{ ok: boolean; error?: string; turn?: HubTurn }> {
  return call<{ ok: boolean; error?: string; turn?: HubTurn }>('reply', { id, text, ...wantFor(id) });
}
/** Voice-started sessions use the new-session defaults you last picked. */
export function voiceNew(project: string, text: string): Promise<NewSessionResult> {
  return call<NewSessionResult>('new', { project, text, voice: true, ...voiceDefaults() });   // Settings → Apps → Claude → "Hey Claude"
}
export const voiceAnswer = (allow: boolean): void => answer(allow);
export const refreshView = refresh;

// ---------- photos (the Camera and Photos apps) ----------
/**
 * Ask Claude about a photo: it goes with the next message. With a session open that can take a reply, the photo
 * is attached to that reply; otherwise the new-session composer opens with it. `text` is a draft to start the keyboard with.
 */
export function askWithPhoto(photoId: string, text = ''): void {
  if (!photos.includes(photoId)) photos = [...photos, photoId].slice(-MAX_PHOTOS);
  draft = text;
  if (mode === 'session' && openId && view?.canReply) { render(); return; }
  void openNew();
}

/** Text for Claude, as a draft: the open session takes it as its reply draft, else the new-session composer opens with it. */
export function askWithText(text: string): void {
  draft = text;
  if (mode === 'session' && openId && view?.canReply) { render(); return; }
  void openNew();
}

// ---------- a message's row: copy, fork, pin, read aloud (tap a message to open its row) ----------
const repaintLog = (): void => { if (view && mode === 'session') paintLog(view, activeTurn(), true); };

/** A tap on a message opens its row; a tap on the open one, or on the space around, shuts it. */
function tapMsg(key: string | null): void {
  dismissHint();   // the first tap on any message: the hint has done its job
  openMsg = key && key !== openMsg ? key : null;
  repaintLog();
}

/** The "Pinned · n" chip at the top: how many messages in view are pinned. */
function paintPins(): void {
  const n = (view?.transcript || []).filter(e => e.pinned).length;
  $('svPins').hidden = !n || mode !== 'session';
  $('svPinsText').textContent = `Pinned · ${n}`;
}

/** The chip scrolls to the next pinned message, and round again. */
function jumpPins(): void {
  const log = $('svLog');
  const els = [...log.querySelectorAll<HTMLElement>('.m-msg.pinned')];
  if (!els.length) return;
  const el = els[pinIdx % els.length];
  pinIdx++;
  const r = el.getBoundingClientRect(), lr = log.getBoundingClientRect();
  log.scrollBy({ top: r.top - lr.top - log.clientHeight / 3, behavior: 'smooth' });
}

function flashSub(text: string): void {
  $('svSub').textContent = text;
  window.setTimeout(() => { if (view) render(); }, 3000);
}

function msgAct(act: string, key: string): void {
  const e = entryFor(key);
  if (!e) return;
  if (act === 'copy') void copyMsg(e.text, key);
  else if (act === 'pin') togglePin(e);
  else if (act === 'fork') forkMsg(e);
  else if (act === 'speak') speakMsg(e, key);
}

/** Copy the message's text (its Markdown, for Claude's replies). The tablet's WebView may refuse the newer way. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* not allowed here: try the older way */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

async function copyMsg(text: string, key: string): Promise<void> {
  const ok = await copyText(text);
  report(ok ? 'copy' : 'copy-failed');
  // the time on the row says so for a moment, then goes back to how long ago
  const el = [...$('svLog').querySelectorAll<HTMLElement>('[data-when]')].find(x => x.dataset.when === key);
  if (!el) return;
  el.textContent = ok ? 'Copied' : 'Couldn’t copy';
  window.setTimeout(() => { if (el.isConnected) el.textContent = relAgo(entryFor(key)?.at ?? null); }, 1500);
}

/** A code block's Copy button: the same clipboard path and the same "Copied" word as a message's Copy. */
/** A link in Claude's reply: a new tab in the Browser app, never the hub's own WebView. Only http(s) goes. */
function openReplyLink(href: string): void {
  let u: URL;
  try { u = new URL(href); } catch { return; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
  const sent = browser.openUrl(u.href);
  report(sent ? 'reply-link' : 'reply-link-unavailable');
  if (sent) openApp('browser');
  else notify({ title: 'Couldn’t open that link', body: u.host, app: 'claude' }, false);
}

async function copyCode(btn: HTMLElement): Promise<void> {
  const code = btn.closest('.md-code')?.querySelector('code')?.textContent ?? '';
  const ok = await copyText(code);
  report(ok ? 'copy' : 'copy-failed');
  btn.textContent = ok ? 'Copied' : 'Couldn’t copy';
  window.setTimeout(() => { if (btn.isConnected) btn.textContent = 'Copy'; }, 1500);
}

/** Pin or unpin: shown at once, then sent (behind the PIN like the other actions), then the view is read again. */
function togglePin(e: { id?: string; pinned?: boolean }): void {
  const id = openId;
  if (!id || !e.id) return;
  const on = !e.pinned, message = e.id;
  e.pinned = on;
  repaintLog(); paintPins();
  report(on ? 'pin' : 'unpin');
  void withPin(async () => {
    await call<{ ok: boolean; error?: string }>('pin', { session: id, message, on });
    void refresh();
  });
}

/** A new session that carries on from this reply (only Claude's replies can be forked: see server/manage.ts). */
function forkMsg(e: { id?: string; kind: string }): void {
  const id = openId;
  if (!id || !e.id || e.kind !== 'assistant') return;
  const message = e.id;
  void withPin(async () => {
    const r = await call<{ ok: boolean; sessionId?: string; error?: string }>('fork', { session: id, message });
    report(r.ok ? 'fork' : 'fork-failed');
    void loadHistory();
    if (r.ok && r.sessionId) { openSession(r.sessionId); return; }
    flashSub('Couldn’t fork that one. Try again.');
  });
}

/** Read a message aloud through the tablet's voice; tapping again while it reads stops it. */
function speakMsg(e: { text: string }, key: string): void {
  if (speakingKey === key) {
    try { voice.stopSpeaking(); } catch { /* the tablet app is busy */ }
    speakingKey = null; repaintLog();
    return;
  }
  const text = speakable(e.text, 2000);
  if (!text) return;
  try { speakingKey = voice.speak(text, `msg:${key}`).ok ? key : null; } catch { speakingKey = null; }
  repaintLog();
}

// ---------- a photo from the conversation, full size (tap anywhere to close) ----------
function showPhoto(src: string): void {
  $<HTMLImageElement>('svPhotoFull').src = src;
  $('svPhotoView').hidden = false;
  report('photo-open');
}
function hidePhoto(): void {
  $('svPhotoView').hidden = true;
  $<HTMLImageElement>('svPhotoFull').removeAttribute('src');
}

// ---------- hooks for the Claude app ----------
/** Called with every usage refresh: keeps the sidebar current, and pulls the screen over when a reply needs an answer. */
export function onUsage(u: Usage): boolean {
  sessions = u.sessions || [];
  paintSidebar();
  const asking = (u.turns || []).filter(t => t.status === 'approval' && t.approval);
  for (const t of asking) {
    if (!attended.has(t.approval!.id)) {
      attended.add(t.approval!.id);
      ctx.requestAttention();
      alertFor('approval', { title: 'Claude needs your OK', body: t.approval!.summary, app: 'claude' });   // Settings → Notifications
      if (currentSession() !== t.sessionId) openSession(t.sessionId);
    }
  }
  // a reply that was running and is now finished: "Claude finished" (not on the first look, so old replies stay quiet)
  for (const t of u.turns || []) {
    const was = turnStatus.get(t.id);
    if (was && (was === 'running' || was === 'approval') && t.status === 'done') alertFor('done', { title: 'Claude finished', body: t.title, app: 'claude' });
    turnStatus.set(t.id, t.status);
  }
  return asking.length > 0;
}
const turnStatus = new Map<string, string>();

export function initReply(context: AppContext): void {
  ctx = context;
  initPin(ctx);
  initSidebar(() => paintSidebar(true));
  onMicChange(repaintComposer);

  // the dashboard's list
  $('sess').addEventListener('click', e => {
    const el = e.target as Element;
    if (el.closest('[data-more]')) { openList(); return; }
    const row = el.closest<HTMLElement>('[data-id]');
    if (row?.dataset.id) openSession(row.dataset.id);
  });
  $('newSess').addEventListener('click', () => { void openNew(); });

  // the sidebar
  $('svBack').addEventListener('click', () => { closeSession(); report('session-close'); });
  $('svNew').addEventListener('click', () => { void openNew(); });
  $('svList').addEventListener('click', e => {
    const el = e.target as Element;
    const f = el.closest<HTMLElement>('[data-folder]');
    if (f) { toggleFolder(f.dataset.folder!); paintSidebar(true); report('sessions-folder'); return; }
    const m = el.closest<HTMLElement>('[data-menu]');   // a row's ⋯: its actions (manage.ts)
    if (m?.dataset.menu) { openSessionMenu(m.dataset.menu, m.dataset.title || '', m.dataset.arch === '1'); return; }
    const row = el.closest<HTMLElement>('[data-id]');
    if (row?.dataset.id) openSession(row.dataset.id);
  });
  $('svArch').addEventListener('click', () => {   // the Archived view, and back
    setArchivedView(!historyArchivedView());
    paintSidebar(true);
    report('sessions-archived');
  });
  initManage(ctx, (id, what) => {
    if (what !== 'unarchived') {   // gone from the list: if it was open, go to the new-session screen
      sessions = sessions.filter(s => s.id !== id);
      if (currentSession() === id) void openNew();
    }
    void loadHistory();
    paintSidebar(true);
  });

  // the conversation
  $('svLog').addEventListener('click', e => {
    const el = e.target as Element;
    const cc = el.closest<HTMLElement>('[data-copy-code]');
    if (cc) { void copyCode(cc); return; }   // a code block's Copy: the message's row stays as it was
    const lk = el.closest<HTMLElement>('[data-href]');
    if (lk?.dataset.href) { openReplyLink(lk.dataset.href); return; }   // a link: the Browser app, the row stays as it was
    const ph = el.closest<HTMLElement>('[data-photo]');
    if (ph?.dataset.photo) { showPhoto(ph.dataset.photo); return; }
    const act = el.closest<HTMLElement>('[data-act]');
    if (act?.dataset.act) { msgAct(act.dataset.act, act.closest<HTMLElement>('[data-msg]')?.dataset.msg || ''); return; }
    const g = el.closest<HTMLElement>('[data-group]');
    if (g) { const id = g.dataset.group!; if (openGroups.has(id)) openGroups.delete(id); else openGroups.add(id); repaintLog(); return; }
    const c = el.closest<HTMLElement>('[data-clip]');
    if (c) { const id = c.dataset.clip!; if (openClips.has(id)) openClips.delete(id); else openClips.add(id); repaintLog(); return; }
    if (el.closest('.m-acts')) return;   // the row's own empty space: it stays open
    tapMsg(el.closest<HTMLElement>('[data-msg]')?.dataset.msg || null);
  });
  // a tap outside the log (the composer, the sidebar) shuts an open row
  document.addEventListener('pointerdown', e => {
    if (!openMsg || (e.target as Element).closest('#svLog')) return;
    openMsg = null; repaintLog();
  });
  $('svPins').addEventListener('click', jumpPins);
  $('svPlan').addEventListener('click', e => {   // code and links in a plan work here too
    const el = e.target as Element;
    const cc = el.closest<HTMLElement>('[data-copy-code]');
    if (cc) { void copyCode(cc); return; }
    const lk = el.closest<HTMLElement>('[data-href]');
    if (lk?.dataset.href) openReplyLink(lk.dataset.href);
  });
  voice.on(ev => {   // read-aloud state, from the tablet
    if (ev.type === 'speaking' && ev.id.startsWith('msg:')) { speakingKey = ev.id.slice(4); repaintLog(); }
    else if (speakingKey && ((ev.type === 'spoken' && ev.id === `msg:${speakingKey}`) || ev.type === 'stop')) { speakingKey = null; repaintLog(); }
  });
  // following the end: stay there when the area under the conversation grows or shrinks
  let stick = true;
  $('svLog').addEventListener('scroll', () => { const l = $('svLog'); stick = l.scrollHeight - l.scrollTop - l.clientHeight < 80; updateJump(); }, { passive: true });
  new ResizeObserver(() => { const l = $('svLog'); if (stick) l.scrollTop = l.scrollHeight; }).observe($('svLog'));
  $('svJump').addEventListener('click', () => { const log = $('svLog'); log.scrollTop = log.scrollHeight; updateJump(); });
  $('svNudge').addEventListener('click', () => { const id = $('svNudge').dataset.id; if (id) openSession(id); });

  // new session
  $('nsFolders').addEventListener('click', e => {
    const row = (e.target as Element).closest<HTMLElement>('[data-project]');
    const p = row && projects.find(x => x.id === row.dataset.project);
    if (p) { chosen = p; paintFolders(); report('new-session-folder'); }
  });
  $('svFolderChip').addEventListener('click', () => {   // new session: cycle through folders, like a quick picker
    if (mode !== 'new' || !projects.length) return;
    const i = chosen ? projects.findIndex(p => p.id === chosen!.id) : -1;
    chosen = projects[(i + 1) % projects.length]; paintFolders();
  });

  // the dock and the composer
  $('svQuick').addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-say]');
    if (b) send(b.dataset.say!);
  });
  const write = () => { if (mode === 'new') askFirstMessage(); else typeReply(); };
  $('svInput').addEventListener('click', write);
  $('svPlus').addEventListener('click', write);
  $('svSend').addEventListener('click', sendPhotos);
  // a starter fills the composer: the keyboard opens with it, ready to send or edit
  $('nsStarts').addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-start]');
    if (!b?.dataset.start || !chosen || starting) return;
    draft = b.dataset.start;
    report('new-session-starter');
    askFirstMessage();
  });
  $('svMic').addEventListener('click', () => {
    if (mode === 'new') micTap({ kind: 'new', projectId: chosen?.id || null });
    else if (openId) micTap({ kind: 'session', sessionId: openId });
    report('mic');
  });
  $('svAllow').addEventListener('click', () => answer(true));
  $('svAllowEdits').addEventListener('click', () => answer(true, 'acceptEdits'));
  $('svDeny').addEventListener('click', () => answer(false));
  // the session controls under the composer
  initControls(ctx.root, $('sv'), shownSettings, pickSetting, repaintComposer);
  void loadModels();
  $('svStop').addEventListener('click', stop);
  $('svPhotos').addEventListener('click', e => {   // a photo's × takes it off the next message
    const rm = (e.target as Element).closest<HTMLElement>('[data-rm]');
    if (!rm?.dataset.rm) return;
    photos = photos.filter(p => p !== rm.dataset.rm);
    repaintComposer();
  });
  $('svPhotoView').addEventListener('click', hidePhoto);

  // Back (system.ts), topmost first: the full-size photo closes; the session's own sheets and menus close in their
  // modules (sessions/manage.ts, pin.ts, controls.ts, priority 20); then the Archived view goes back to the sessions;
  // then the session closes to the Claude screen. Only while Claude is on screen.
  onBack(() => {
    if (!ctx.isVisible() || $('svPhotoView').hidden) return false;
    hidePhoto();
    return true;
  }, 20);
  onBack(() => {
    if (!ctx.isVisible() || mode === 'closed') return false;
    if (historyArchivedView()) { setArchivedView(false); paintSidebar(true); return true; }
    closeSession();
    report('session-close');
    return true;
  }, 10);
}
