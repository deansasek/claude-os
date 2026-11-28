// The Sessions screen, laid out like the Claude desktop app's Code tab:
//   left   sessions grouped by folder (sessions/sidebar.ts), "New session" at the top, Back to the dashboard
//   middle the conversation (sessions/transcript.ts), or for a new session the critter and the folder choice
//   bottom an approval / quick replies / why you can't reply, and the composer with its chips
// Replies, approvals, Stop and new sessions all go through the server (server/turns.ts), behind the
// PIN (sessions/pin.ts). Sessions open on the PC are read-only here: Claude Home never resumes them.
import { esc, getJson, report } from '../../../core/web/dom.ts';
import { browser, voice } from '../../../core/web/device.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import { recordClip } from '../../../core/web/clipboard-history.ts';
import { markdown } from '../../../core/web/markdown.ts';
import { alertFor, notify, onBack, openApp } from '../../../core/web/system.ts';
import type { AppContext } from '../../../core/web/shell.ts';
import type { HubPermission, HubTurn, LiveSession, NewSessionResult, Project, ReplyBlock, SessionSettings, SessionView, TranscriptEntry, Usage } from '../api.ts';
import { subagentsWorking } from './sessions/sidebar-groups.ts';
import { closeMenu, initControls, loadModels, newDefaults, newFolderPref, paintControls, remember, settingsFor, voiceDefaults, wantFor, type ControlsView } from './sessions/controls.ts';
import { micAvailable, micTap, onMicChange } from './sessions/mic.ts';
import { call, hidePin, initPin, withPin } from './sessions/pin.ts';
import { historyArchivedCount, historyArchivedView, loadHistory, setArchivedView } from './sessions/history.ts';
import { historyTitle, initSidebar, sidebarHtml, toggleFolder } from './sessions/sidebar.ts';
import { closeSessionMenu, initManage, openSessionMenu } from './sessions/manage.ts';
import { msgKey, type MsgUi, openClips, openGroups, quickReplies, relAgo, SPARK, SPARK_RAYS, transcriptHtml } from './sessions/transcript.ts';
import { speakable } from './voice.ts';
import { initNative, NATIVE_ID, nativeListed, nativeMetaText, nativeOn, nativeSend, nativeStop, nativeView } from './native.ts';
import { elapsedText } from './native-stream.ts';

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
let waitingOk = new Set<string>();   // the sessions whose Hub turn waits for your OK (the sidebar says so)
// photos (the Camera and Photos apps) to send with the next message, and a draft to start the keyboard with
const MAX_PHOTOS = 3;
/** The longest message the composer takes. The server cuts a message to the same length (server/turns.ts). */
const MAX_MESSAGE = 2000;
let photos: string[] = [];
let draft = '';
// a send that didn't go: the composer says why until you type or send again (shown in place of the placeholder)
let sendNote = '';
// refreshes of the open session that failed in a row (the PC did not answer); two or more shows "Can’t reach your PC"
let refreshFails = 0;
const READ_TIMEOUT_MS = 8000;      // a poll read the PC never answers gives up, so the failure counts
let refreshSeq = 0, appliedSeq = 0; // each poll takes a number; an answer older than the one applied is dropped
const SEND_NOTE: Record<string, string> = {
  unreachable: 'Can’t reach your PC just now. Your message is kept: send it again.',
  too_many_photos: 'Too many photos for one message. Take one off.',
  photos_on_pc: 'Photos can’t go to a session open on your PC. Send words only.',
};
const takeDraft = (): string => { const t = draft; draft = ''; return t; };
// the text a reply composer closed with unsent (Cancel, a tap outside it): it returns to that session's composer
let replyDraft: { id: string | null; text: string } = { id: null, text: '' };
const attended = new Set<string>();                  // approvals we've already pulled the screen for
const activeTurn = (): HubTurn | null => { const t = view?.turn; return t && (t.status === 'running' || t.status === 'approval') ? t : null; };

const BLOCKED: Record<ReplyBlock, [string, string]> = {
  open_on_pc: ['Open on your PC', 'Reply in that window. To reply here instead, turn on the PC link once on the PC (npm run pc-link) and reopen that session there.'],
  busy: ['Claude is still working', 'Wait for this session to finish its turn, then you can reply from here.'],
  too_old: ['This one has gone quiet', 'You can read it here. ClaudeOS only replies to sessions active in the last 30 minutes.'],
  no_pin: ['Set a PIN first', 'Replies from ClaudeOS need the ClaudeOS PIN. Set it in Settings, then come back.'],
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

/** The sidebar's sessions: the live list, with the open session's freshest copy (kept even if it went quiet), and the
 *  tablet's own chat (native.ts), which the hub's list never has, so it stays listed after the session is closed. */
function sideList(): LiveSession[] {
  const n = nativeListed();
  const list = n ? [n, ...sessions.filter(x => x.id !== n.id)] : sessions;
  const s = mode === 'session' ? view?.session : null;
  if (!s?.id) return list;
  return list.some(x => x.id === s.id) ? list.map(x => (x.id === s.id ? s : x)) : [s, ...list];
}

function paintSidebar(force = false): void {
  if (mode === 'closed') return;
  const html = sidebarHtml(sideList(), mode === 'session' ? openId : null, waitingOk);
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
  // the running reply shows its elapsed time (tablet and PC): the key changes with each whole second, so the line repaints
  const elapsed = active ? elapsedText(active.startedAt) : '';
  const tail = active ? `${active.status}|${active.progress[active.progress.length - 1] || ''}|${elapsed}` : (v.turn?.status === 'error' ? 'error' : '');
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
    // "Thinking · 0:42": the time since the reply was sent (native.ts turnStartedAt, turns.ts startedAt)
    const line = `${said} · ${elapsedText(active.startedAt)}`;
    html += `<div class="m-working">${SPARK}<span>${esc(line)}</span></div>`;
  } else if (v.turn?.status === 'error') {
    // the last reply did not finish: say so, until the next reply starts
    html += `<div class="m-note">${esc(v.turn.error || 'That reply didn’t finish. Try again.')}</div>`;
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
interface ComposerState { ph: string; ready: boolean; folder: string; pick: boolean; noFolder?: boolean; ctl: ControlsView; stop: boolean; mic: boolean }
const NO_CONTROLS: ControlsView = { settings: { model: null, effort: null, mode: null }, context: null, interactive: false, show: false };

function paintComposer(c: ComposerState): void {
  $('svPh').textContent = c.ph;
  $('svComposer').classList.toggle('off', !c.ready);
  $('svFolderName').textContent = c.folder;
  $('svFolderChip').classList.toggle('strong', c.pick);
  $('svFolderChip').hidden = !!c.noFolder;   // a tablet chat has no folder to choose
  paintControls(ctx.root, c.ctl);
  if (!c.ctl.interactive) closeMenu();
  $('svStop').hidden = !c.stop;
  // photos ready to go: the ink Send takes the mic's place (nothing typed is needed to send a photo)
  const sendable = c.ready && photos.length > 0 && !tabletTarget();
  $('svSend').hidden = !sendable;
  $('svMic').hidden = !c.mic || !micAvailable() || sendable;
  paintPhotos();
}

/** The composer's placeholder while photos wait: say what the Send button will do. */
const withPhotos = (ph: string, ready: boolean): string => (ready && photos.length ? 'Add a note, or just send the photo' : ph);

/** A tablet chat is the target (the new-chat screen with tablet chats on, or the tablet's own chat open). It takes words only. */
const tabletTarget = (): boolean => (mode === 'new' && nativeOn()) || (mode === 'session' && openId === NATIVE_ID);
/** Said when photos cannot go, so they are never dropped without a sign. */
const PHOTO_REFUSED = { title: 'Photo not sent', body: 'Chats on this tablet take words only. Send photos from a session on your PC.', app: 'claude' };

/** The photos waiting to go with the next message: a thumbnail each, with × to take it off. */
function paintPhotos(): void {
  const box = $('svPhotos');
  const key = photos.join(',');
  box.hidden = photos.length === 0 || tabletTarget();
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
  if (!same) { view = null; drawnLog = ''; openMsg = null; pinIdx = 0; sendNote = ''; refreshFails = 0; }
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
  photos = []; draft = ''; replyDraft = { id: null, text: '' }; openMsg = null;
  closeMenu();
  $('svNudge').hidden = true;
  clearInterval(poll);
  $('sv').hidden = true; hidePin();
  closeSessionMenu(); $('ncConfirm').hidden = true; replaceText = null; hidePhoto();   // the overlays inside Sessions go with it
  ctx.root.classList.remove('sv-open');
  if (Keyboard.isOpen) Keyboard.close('nav');
}

export const isOpen = () => mode !== 'closed';
export const currentSession = (): string | null => (mode === 'session' ? openId : null);

async function refresh(): Promise<void> {
  const id = openId;
  if (mode !== 'session' || !id) return;
  if (id === NATIVE_ID) { view = nativeView(); render(); return; }   // the tablet's own chat (native.ts): no hub
  const seq = ++refreshSeq;
  let v: SessionView;
  // send the version we hold: the Hub answers "unchanged" with no transcript when nothing changed
  const have = view?.version ?? '';
  try { v = await getJson<SessionView>(`/api/claude/session?id=${encodeURIComponent(id)}&have=${encodeURIComponent(have)}`, READ_TIMEOUT_MS); }
  catch {
    if (seq < appliedSeq) return;   // a newer read already answered: this miss is old news
    // the PC did not answer: after two tries the state line says so (the next poll tries again)
    refreshFails++;
    if (refreshFails >= 2 && mode === 'session' && openId === id) render();
    return;
  }
  if (mode !== 'session' || openId !== id) return;   // switched away while it loaded
  if (seq < appliedSeq) return;   // a newer read answered first: do not paint older state over it
  appliedSeq = seq;
  refreshFails = 0;
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
  $('svSub').textContent = openId === NATIVE_ID ? nativeMetaText() : [s?.folder, s?.branch && s.branch !== 'HEAD' ? s.branch : null].filter(Boolean).join(' · ');

  const state = $('svState'), stateText = $('svStateText');
  // the dot means what it means everywhere: blue = your turn, clay = Claude working
  if (active) { state.className = active.status === 'approval' ? 'live wait' : 'live work'; stateText.textContent = active.status === 'approval' ? 'Needs your OK' : 'Working'; }
  else if (s?.open) { state.className = 'live'; stateText.textContent = 'Open on your PC'; }
  else if (past) { state.className = 'live'; stateText.textContent = 'Past session'; }
  else if (s?.state === 'waiting') { state.className = 'live wait'; stateText.textContent = 'Your turn'; }
  else { state.className = 'live'; stateText.textContent = !s ? 'Gone' : s.state === 'thinking' || s.state === 'tool' ? 'Working on your PC' : 'Quiet'; }
  if (refreshFails >= 2) stateText.textContent = 'Can’t reach your PC. Trying again.';
  // "N subagents working" (the sidebar's words), beside the state; hidden when no subagent is running
  const subs = s ? subagentsWorking(s) : '';
  $('svSubs').hidden = !subs;
  $('svSubs').textContent = subs;

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
  // a quiet session can still be continued: a copy from its last reply is a session the Hub keeps replying to
  $('svBlockedFork').hidden = !(view.reason === 'too_old' && lastReply());
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
    mic: !active && view.canReply && openId !== NATIVE_ID,
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
let foldersFailed = false;   // the last read of the folder list did not reach the PC (not: the PC has none)
let chosen: Project | null = null;
const FOLDER_ICON = '<svg viewBox="0 0 16 16"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/></svg>';

function paintFolders(): void {
  const ago = (iso: string) => { if (!iso) return ''; const m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
  $('nsFolders').innerHTML = projects.map(p =>
    `<button class="ns-row${chosen?.id === p.id ? ' on' : ''}" data-project="${esc(p.id)}">${FOLDER_ICON}<span class="ns-name">${esc(p.name)}</span><span class="ns-when">${esc(p.lastUsed ? ago(p.lastUsed) : p.detail)}</span></button>`).join('')
    || (foldersFailed ? '<div class="ns-row empty">Can’t reach your PC just now. Open New session again to retry.</div>' : '<div class="ns-row empty">No recent folders found.</div>');
  $('nsHint').textContent = nativeOn() ? 'New chats run on this tablet (Settings → Apps → Claude). No folder needed.' : chosen ? `Claude will work in ${chosen.detail.startsWith('~') || chosen.detail.includes('/') ? chosen.detail : chosen.name}.` : 'Pick a folder, then tell Claude what to do.';
  paintNewComposer();
}

function paintNewComposer(): void {
  const native = nativeOn();   // Settings → Apps → Claude: new chats run on the tablet (native.ts), no folder needed
  const ready = (!!chosen || native) && !starting;
  paintComposer({
    ph: native ? 'Ask Claude on this tablet' : withPhotos(starting && chosen ? `Starting in ${chosen.name}…` : 'Describe a task or ask a question', ready),
    ready, noFolder: native, folder: chosen ? chosen.name : 'Choose folder', pick: true,
    ctl: { settings: newDefaults(), context: null, interactive: !starting, show: !native }, stop: false, mic: ready && !native,
  });
  paintStarters(ready);
}

/** Starters: short, sentence-case first messages. Tap one to fill the composer. A tablet chat has no tools, so its
 *  starters need none; a folder session gets the folder starters. */
const STARTERS = ['Summarise what changed today', 'Fix the failing tests', 'Explain how this folder is organised', 'Find loose ends and TODOs'];
const TABLET_STARTERS = ['Explain something in plain words', 'Help me write a message', 'Plan my week', 'Suggest something to cook tonight'];
function paintStarters(ready: boolean): void {
  const box = $('nsStarts');
  const native = nativeOn();
  const list = native ? TABLET_STARTERS : chosen ? STARTERS : [];
  const show = ready && list.length > 0;
  const key = show ? (native ? 'tablet' : chosen!.id) : '';
  box.hidden = !show;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = show ? list.map(s => `<button class="ns-start" data-start="${esc(s)}">${esc(s)}</button>`).join('') : '';
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

/** The new-session screen (also "Chat on this tablet" on the offline Claude screen, index.ts). */
// each New session open takes a number; a folder read from an earlier open that answers late does not replace this one
let foldersSeq = 0;
export async function openNew(): Promise<void> {
  const seq = ++foldersSeq;
  openId = null; view = null; picking = true; starting = false;
  showScreen('new');
  $('sv').classList.remove('readonly');
  $('svTitle').textContent = 'New session';
  $('svSub').textContent = '';
  $('svState').className = 'live'; $('svStateText').textContent = nativeOn() ? 'On this tablet' : 'On this computer';
  $('svSubs').hidden = true;
  $('svNudge').hidden = true;
  $('svApproval').hidden = true; $('svQuick').hidden = true; $('svBlocked').hidden = true;
  $('nsFolders').hidden = nativeOn();   // a tablet chat needs no folder list
  $('nsFolders').innerHTML = '<div class="ns-row empty">Loading folders…</div>';
  paintNewComposer();
  report('new-session-open');
  try {
    const p = await getJson<Project[]>('/api/claude/projects', READ_TIMEOUT_MS);
    if (seq !== foldersSeq) return;   // a newer open came first: its folder list is the one to keep
    projects = p; foldersFailed = false;
  } catch { if (seq !== foldersSeq) return; projects = []; foldersFailed = true; }
  if (!picking || mode !== 'new') return;
  // Settings → Sessions: the default folder if one is set, else the most recent folder (like the desktop app)
  const dflt = newFolderPref();
  chosen = projects.find(p => p.id === chosen?.id) || projects.find(p => p.id === dflt) || projects[0] || null;
  paintFolders();
}

function askFirstMessage(): void {
  if (nativeOn() && !starting) {   // a new chat on the tablet's own Claude CLI: text only, no folder, no PIN
    Keyboard.open({
      value: takeDraft(), placeholder: 'Ask Claude on this tablet', autoCap: true, max: MAX_MESSAGE, done: 'Send',
      onDone: startNativeChat,
    });
    return;
  }
  if (!chosen || starting) return;
  const p = chosen;
  Keyboard.open({
    value: takeDraft(), placeholder: photos.length ? 'Ask about the photo, or send it as it is' : `Describe a task for ${p.name}`, autoCap: true, max: MAX_MESSAGE, done: 'Send',
    onDone: text => { if (text.trim() || photos.length) startNewSession(p, text.trim()); },
  });
}

/** A new chat on the tablet's own Claude CLI with its first message (the new-chat composer's Send). A chat already
 *  there is replaced only after the OK on ncConfirm; Keep the chat returns the text to the composer. */
let replaceText: string | null = null;
function startNativeChat(text: string): void {
  const first = text.trim();
  if (!first) return;
  if (nativeListed()) { replaceText = first; $('ncConfirm').hidden = false; report('new-native-replace'); return; }
  newNativeChat(first);
}
function newNativeChat(first: string): void {
  nativeSend(first, true); picking = false; photos = []; openSession(NATIVE_ID); report('new-native-chat');
}
function keepNativeChat(): void {
  $('ncConfirm').hidden = true;
  const t = replaceText; replaceText = null;
  if (t) { draft = t; askFirstMessage(); }
}

function startNewSession(p: Project, text: string): void {
  void withPin(async () => {
    starting = true; paintNewComposer();
    $('ns').classList.add('starting');
    let r: NewSessionResult;
    try { r = await call<NewSessionResult>('new', { project: p.id, text, photoIds: photos, ...newDefaults() }); }
    catch { r = { ok: false, error: 'unreachable' }; if (text) draft = text; }   // the PC did not answer: keep the message to send again
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
  unreachable: 'Can’t reach your PC just now. Your message is kept: send it again.',
  no_such_folder: 'That folder isn’t there any more. Pick another one.',
  too_many_photos: 'Too many photos for one message. Take one off.',
  empty: 'Write a task, or add a photo, then send.',
};

/** Send with no text: the photos go as they are (Claude asks what it sees). */
function sendPhotos(): void {
  if (mode === 'new' && chosen && !starting && !nativeOn()) startNewSession(chosen, '');
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
  if (id === NATIVE_ID) {   // the tablet's own chat: words only (photos queued for a PC session are not sent, and say so)
    if (photos.length) { photos = []; notify(PHOTO_REFUSED, false); }
    if (text) nativeSend(text);
    report('reply-native');
    return;
  }
  $('svPh').textContent = 'Sending…';   // shown until the next refresh repaints the composer (every 2 s)
  void withPin(async () => {
    let r: { ok: boolean; error?: string; turn?: HubTurn };
    try { r = await call<{ ok: boolean; error?: string; turn?: HubTurn }>('reply', { id, text, photoIds: photos, ...wantFor(id) }); }
    catch { r = { ok: false, error: 'unreachable' }; }
    if (r.ok) { photos = []; sendNote = ''; }
    else if (view && openId === id) {
      // a reason the composer has a sentence for: it blocks the reply (BLOCKED); anything else is a note that stays until you try again
      if (r.error && r.error in BLOCKED) { view = { ...view, canReply: false, reason: r.error as ReplyBlock }; sendNote = ''; }
      else { sendNote = SEND_NOTE[r.error || ''] || 'That didn’t send. Try again.'; if (text) replyDraft = { id, text }; }
    }
    report('reply');
    void refresh();
  });
}

function typeReply(): void {
  if (mode !== 'session' || !view?.canReply || activeTurn()) return;
  sendNote = '';
  const session = openId;   // the session this draft belongs to: openId may change while the keyboard closes
  const kept = replyDraft.id === session ? replyDraft.text : '';
  replyDraft = { id: null, text: '' };
  Keyboard.open({
    value: kept, placeholder: photos.length ? 'Ask about the photo, or send it as it is' : 'Reply to Claude', autoCap: true, max: MAX_MESSAGE, done: 'Send',
    onDone: text => { if (text.trim() || photos.length) send(text.trim()); },
    // closed without Send: the text stays as this session's reply draft
    onClose: (reason, text) => { if (reason !== 'done') replyDraft = { id: session, text }; },
  });
}

/** Allow or deny. For a plan, `then` is the mode Claude carries on in (Manual unless you pick Accept edits). */
function answer(allow: boolean, then: HubPermission = 'default'): void {
  const t = view?.turn, a = t?.approval;
  if (!t || !a) return;
  void withPin(async () => {
    try { await call('approve', { turn: t.id, approval: a.id, allow, ...(a.kind === 'plan' ? { mode: then } : {}) }); }
    catch (e) {
      if ((e as Error).message === 'locked_out') throw e;   // withPin shows the PIN pad
      notify({ title: 'Couldn’t reach your PC', body: 'Your answer didn’t reach Claude. Try again.', app: 'claude' }, false);
      report('approve-failed');
      void refresh();
      return;
    }
    report(allow ? 'approve' : 'deny');
    void refresh();
  });
}

function stop(): void {
  const t = activeTurn();
  if (!t) return;
  if (openId === NATIVE_ID) { nativeStop(); report('stop-native'); return; }
  void withPin(async () => {
    let r: { ok: boolean; error?: string };
    try { r = await call<{ ok: boolean; error?: string }>('stop', { turn: t.id }); }
    catch { r = { ok: false, error: 'unreachable' }; }
    if (r.error === 'unreachable') sendNote = 'Couldn’t reach the PC to stop Claude. Try again.';
    report(r.ok ? 'stop' : 'stop-failed');
    void refresh();
  });
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
  return new Promise((resolve, reject) => {
    let ran = false;
    void withPin(async () => { const r = await fn(); ran = true; resolve(r); }).then(() => { if (!ran) resolve(null); }, reject);
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
  draft = text;
  // words only on a tablet chat: a closed Claude opens the tablet's new chat, so it counts too
  const onPcSession = mode === 'session' && !!openId && !!view?.canReply;
  if (tabletTarget() || (!onPcSession && nativeOn())) {   // the photo is not attached, and the user is told
    notify(PHOTO_REFUSED, false);
    report('photo-tablet-refused');
    if (mode === 'session' && openId && view?.canReply) { render(); return; }
    void openNew();
    return;
  }
  if (!photos.includes(photoId)) photos = [...photos, photoId].slice(-MAX_PHOTOS);
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
export async function copyText(text: string): Promise<boolean> {
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
  if (ok) recordClip(text);
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
  if (ok) recordClip(code);
  report(ok ? 'copy' : 'copy-failed');
  btn.textContent = ok ? 'Copied' : 'Couldn’t copy';
  window.setTimeout(() => { if (btn.isConnected) btn.textContent = 'Copy'; }, 1500);
}

/** Pin or unpin: shown at once, then sent (behind the PIN like the other actions), then the view is read again. */
function togglePin(e: { id?: string; pinned?: boolean }): void {
  const id = openId;
  if (!id || !e.id) return;
  const on = !e.pinned, message = e.id;
  // the change is shown only once the PC has saved it: a failed save, or Cancel on the PIN pad, leaves the message as it was
  void withPin(async () => {
    let ok = false;
    try { ok = (await call<{ ok: boolean; error?: string }>('pin', { session: id, message, on })).ok; }
    catch (err) { if ((err as Error).message === 'locked_out') throw err; }
    if (!ok) { report('pin-failed'); flashSub('Couldn’t pin that. Try again.'); return; }
    e.pinned = on;
    repaintLog(); paintPins();
    report(on ? 'pin' : 'unpin');
    void refresh();
  });
}

/** The latest reply of Claude's in the open session that can be forked (null if there is none yet). */
const lastReply = (): TranscriptEntry | null => [...(view?.transcript || [])].reverse().find(e => e.kind === 'assistant' && !!e.id) || null;

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
  waitingOk = new Set((u.turns || []).filter(t => t.status === 'approval').map(t => t.sessionId));
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
  initNative(() => { if (mode === 'session' && openId === NATIVE_ID) void refresh(); });   // the tablet's chat streams in

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
  $('svBlockedFork').addEventListener('click', () => { const e = lastReply(); if (e) forkMsg(e); });

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

  // a new chat on the tablet that would replace the one there (startNativeChat): the OK, or keep it
  $('ncYes').addEventListener('click', () => {
    $('ncConfirm').hidden = true;
    const t = replaceText; replaceText = null;
    if (t) newNativeChat(t);
  });
  $('ncNo').addEventListener('click', keepNativeChat);
  onBack(() => {   // Back on the confirm keeps the chat, like Keep the chat
    if (!ctx.isVisible() || $('ncConfirm').hidden) return false;
    keepNativeChat();
    return true;
  }, 25);

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
    if (!b?.dataset.start || !(chosen || nativeOn()) || starting) return;
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
