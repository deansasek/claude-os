// Settings for the desk tablet, laid out like the Claude desktop app's Settings, in four groups:
//   You       Profile (photo, name, what Claude calls you, your work), Usage (the plan's limits), Your Claude (instructions)
//   Claude    Sessions (default model, mode and folder), Voice ("Hey Claude", the voice), Notifications (chime, critter, banner or off)
//   Device    Network (Wi-Fi), Bluetooth (read only), Display, Appearance, Sound, Battery (and low power), Keyboard,
//             Apps (each app's settings, and the Android apps in the Launcher), Storage, Date & time
//   System    Privacy & data, Wellbeing (breaks, quiet hours), Security (Desk mode), About (restart, recovery),
//             Developer (wireless debugging, so developer options are never opened)
// Only loaded inside the tablet app. Device things go through core/web/device.ts; the rest through the shared prefs in system.ts.
import { esc, getJson, postJson, renderSparks, report, store } from '../../../core/web/dom.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import { androidApps, device, nativeHas, onResume, onTablet, voice } from '../../../core/web/device.ts';
import type { AdbWifiState, AndroidApp, Battery, BluetoothInfo, ScreenState, Setup, StorageInfo, WifiNet, WifiState } from '../../../core/web/device.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import { applyProfile, initials, onProfile, profile, refreshProfile } from '../../../core/web/profile.ts';
import type { Profile } from '../../../core/web/profile.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { closeApp, failedApps, openedApps, restartApp } from '../../../core/web/shell.ts';
import { monitorLines, uptimeText } from './monitor.ts';
import { autoBrightness, batteryGlyph, chime, clearNotifications, groupedNotesHtml, mutedApps, notifications, onBack, onNotificationsChange, onSystemChange, openApp, prefs, quietNow, railEdgesFor, setTileOrder, sleep, swipeNotices, tileOrder, toggleMuteApp } from '../../../core/web/system.ts';
import { appLabel } from '../../../core/web/notes-group.ts';
import { moveTile, TILE_NAMES } from '../../../core/web/quick-order.ts';
import { backupNote, loadSettings, restoreOutcome, restoreSettings, saveSettings, savedNote } from './backup.ts';
import { resultText, updateStatus, type UpdateAvailable, type UpdateStart } from './update.ts';
import type { QuietHours, RailDir, RailEdge } from '../../../core/web/system.ts';
import { clock, untilText, whenText } from '../../../core/web/format.ts';
import { setThemeMode, themeMode } from '../../../core/web/theme.ts';
import type { ThemeMode } from '../../../core/web/theme.ts';
import { showWelcome } from '../../../core/web/welcome.ts';
import { voiceUi } from '../../../core/web/voice-ui.ts';
import { appSettings, onAppSettingsChange } from '../../../core/web/app-settings.ts';
import type { SettingRow } from '../../../core/web/app-settings.ts';
import { hubReachable } from '../../../core/web/hub-link.ts';
import type { HubPermission, Limits, LimitWindow, ModelChoice, Project, Usage } from '../../claude/api.ts';
import type { Place, PlacesResponse, Weather } from '../../weather/api.ts';
import { checkUsage, nativeLimits, usageCheck, usageCheckable } from '../../claude/web/native.ts';
import { limitsUpdated, usageRows } from '../../claude/web/native-stream.ts';
import { loadModels, modelChoices, newFolderPref, newPref, setNewFolderPref, setNewPref } from '../../claude/web/sessions/controls.ts';
import { manifest } from '../manifest.ts';
import { INSTRUCTIONS_MAX, INSTRUCTIONS_READ_FAILED, NAME_MAX, NICK_MAX, ROLES } from '../api.ts';
import { thumbUrl } from '../../photos/api.ts';
import { handlePluginSeg, initPlugins, loadPlugins, paintPlugins } from './plugins.ts';
import { initPinSettings, paintPinRow } from './pin.ts';
import { toggleQuietDay } from '../../../core/web/quiet-hours.ts';

type Section = 'profile' | 'usage' | 'yourclaude' | 'sessions' | 'plugins' | 'voice' | 'notifications'
  | 'wifi' | 'google' | 'bluetooth' | 'display' | 'appearance' | 'sound' | 'battery' | 'keyboard' | 'apps' | 'storage' | 'datetime'
  | 'privacy' | 'wellbeing' | 'security' | 'about' | 'monitor' | 'developer';
const SECTIONS: Section[] = ['profile', 'usage', 'yourclaude', 'sessions', 'plugins', 'voice', 'notifications', 'wifi', 'google', 'bluetooth', 'display',
  'appearance', 'sound', 'battery', 'keyboard', 'apps', 'storage', 'datetime', 'privacy', 'wellbeing', 'security', 'about', 'monitor', 'developer'];
/** Older names other apps may still use: the Desk mode page is Security now. */
const ALIAS: Record<string, Section> = { desk: 'security', kiosk: 'security' };
/** Sections that need the tablet's own device (Wi-Fi, volume, battery, storage, apps...). On the web (the iPad) they are
 *  not shown: no nav row, no search hit, and no way to open them. */
const TABLET_ONLY: Section[] = ['wifi', 'google', 'bluetooth', 'display', 'sound', 'battery', 'keyboard', 'apps', 'storage', 'datetime', 'security', 'developer'];
const deviceOnlyHidden = (s: Section): boolean => !onTablet && TABLET_ONLY.includes(s);
const SAMPLE = 'Hi, I’m Claude. This is how I sound.';

const svg = (d: string) => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = appIcon('settings');
const NAV_ICONS: Record<string, string> = {
  profile: svg('<circle cx="16" cy="11.5" r="5"/><path d="M6.5 27c1.5-5.2 5-8 9.5-8s8 2.8 9.5 8"/>'),
  usage: svg('<path d="M7 26V18M13 26V11M19 26V15M25 26V7"/>'),
  yourclaude: svg('<path d="M16 6l2.2 6.8L25 15l-6.8 2.2L16 24l-2.2-6.8L7 15l6.8-2.2z"/>'),
  sessions: svg('<path d="M7 9.5A2.5 2.5 0 0 1 9.5 7h13A2.5 2.5 0 0 1 25 9.5v9a2.5 2.5 0 0 1-2.5 2.5H14l-5 4v-4.5A2.5 2.5 0 0 1 7 18.5z"/>'),
  plugins: svg('<path d="M13 6h3.5a2.5 2.5 0 1 1 5 0H25v5.5a2.5 2.5 0 1 1 0 5V26h-5.5a2.5 2.5 0 1 0-5 0H7v-5.5a2.5 2.5 0 1 0 0-5V6z"/>'),
  voice: svg('<rect x="12" y="4.5" width="8" height="14" rx="4"/><path d="M8 15a8 8 0 0 0 16 0M16 23v4.5"/>'),
  notifications: svg('<path d="M9 21V14a7 7 0 0 1 14 0v7l2 2.5H7z"/><path d="M13.5 26.5a2.6 2.6 0 0 0 5 0"/>'),
  wifi: svg('<path d="M5 13a16 16 0 0 1 22 0M9 17.5a10 10 0 0 1 14 0M13 22a4 4 0 0 1 6 0"/><circle cx="16" cy="25.5" r=".8" fill="currentColor"/>'),
  bluetooth: svg('<path d="M10 10.5l12 11L16 27V5l6 5.5-12 11"/>'),
  display: svg('<circle cx="16" cy="16" r="5"/><path d="M16 4v3M16 25v3M4 16h3M25 16h3M7.5 7.5l2.1 2.1M22.4 22.4l2.1 2.1M7.5 24.5l2.1-2.1M22.4 9.6l2.1-2.1"/>'),
  appearance: svg('<circle cx="16" cy="16" r="10.5"/><path d="M16 5.5a10.5 10.5 0 0 1 0 21z" fill="currentColor"/>'),
  sound: svg('<path d="M6 13v6h5l6 5V8l-6 5H6z"/><path d="M21.5 12.5a5 5 0 0 1 0 7M24.5 9.5a9 9 0 0 1 0 13"/>'),
  battery: svg('<rect x="4" y="10" width="21" height="12" rx="3"/><path d="M28 14.5v3M8 14v4"/>'),
  keyboard: svg('<rect x="4.5" y="9" width="23" height="14" rx="2.5"/><path d="M8 13h.5M12 13h.5M16 13h.5M20 13h.5M24 13h.5M8 17.5h16"/>'),
  apps: svg('<rect x="6" y="6" width="8" height="8" rx="2"/><rect x="18" y="6" width="8" height="8" rx="2"/><rect x="6" y="18" width="8" height="8" rx="2"/><rect x="18" y="18" width="8" height="8" rx="2"/>'),
  storage: svg('<ellipse cx="16" cy="9" rx="10" ry="4"/><path d="M6 9v14c0 2.2 4.5 4 10 4s10-1.8 10-4V9M6 16c0 2.2 4.5 4 10 4s10-1.8 10-4"/>'),
  datetime: svg('<circle cx="16" cy="16" r="11"/><path d="M16 9v7l4.5 3"/>'),
  privacy: svg('<path d="M16 4.5l9 3.2v7c0 5.6-3.8 9.8-9 11.8-5.2-2-9-6.2-9-11.8v-7z"/>'),
  wellbeing: svg('<path d="M16 26s-9-5.2-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.8-9 12-9 12z"/>'),
  security: svg('<rect x="8" y="14" width="16" height="12" rx="2.5"/><path d="M11.5 14v-3.5a4.5 4.5 0 0 1 9 0V14"/>'),
  about: svg('<circle cx="16" cy="16" r="11"/><path d="M16 15v7M16 10.5v.5"/>'),
  developer: svg('<path d="M11 10l-6 6 6 6M21 10l6 6-6 6M18 7l-4 18"/>'),
  monitor: svg('<rect x="4.5" y="6" width="23" height="15" rx="2.5"/><path d="M9 16l3.5-3.5 3 2.5 4-5 3.5 4M11 26h10M16 21v5"/>'),
};
const TICK = svg('<path d="M7 16.5l6 6 12-13"/>');
const CHEV = svg('<path d="M13 9l7 7-7 7"/>');
const PLAY = '<svg viewBox="0 0 12 12"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>';

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);
let timers: number[] = [];
let joining: string | null = null;
const joinErrors = new Map<string, string>();
let setup: Setup | null = null;
let stepsOpen = false;
let section: Section = 'profile';

// ---------- helpers ----------
const setSwitch = (id: string, on: boolean) => $(id).setAttribute('aria-checked', String(on));
/** A segmented control's choice: the button whose data-v is `v` is on. */
function setSeg(id: string, v: string): void {
  ctx.root.querySelectorAll<HTMLElement>(`[data-seg="${id}"] button`).forEach(b => b.classList.toggle('on', b.dataset.v === v));
}
/** The row a control sits in. */
const rowOf = (id: string): HTMLElement => $(id).closest<HTMLElement>('.st-row')!;
/** The tag on a row whose native feature the tablet app lacks (same look as "Coming soon"). */
const NEEDS_APP = 'Needs the latest ClaudeOS app';
/** A row that needs a newer tablet app: dimmed, its controls disabled, and the tag shown. ok = the feature is there. */
function gateRow(row: HTMLElement, ok: boolean): void {
  row.classList.toggle('st-off', !ok);
  let tag = row.querySelector<HTMLElement>(':scope > .st-needs');
  if (!tag) {
    tag = document.createElement('span');
    tag.className = 'st-soon st-needs';
    tag.textContent = NEEDS_APP;
    row.append(tag);
  }
  tag.hidden = ok;
  row.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button.hit, input').forEach(c => { c.disabled = !ok; });
}
const bytes = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** A small confirm sheet. */
function confirmSheet(title: string, text: string, yes: string, onYes: () => void): void {
  $('stSheetTitle').textContent = title;
  $('stSheetText').textContent = text;
  $('stSheetYes').textContent = yes;
  $('stSheetNo').hidden = yes === 'OK';
  $('stSheet').hidden = false;
  const close = () => { $('stSheet').hidden = true; };
  $('stSheetNo').onclick = close;
  $('stSheetYes').onclick = () => { close(); onYes(); };
}

// ---------- sections ----------
// what's heard is painted four times a second, but only on the voice section while Settings is on screen
let heardT: number | undefined;
function syncHeard(): void {
  clearInterval(heardT); heardT = undefined;
  if (section === 'voice' && ctx.isVisible()) heardT = window.setInterval(() => { if (section === 'voice' && ctx.isVisible()) paintHeard(); }, 250);
}

function show(raw: string): void {
  const s = (ALIAS[raw] ?? raw) as Section;
  if (!SECTIONS.includes(s) || (s === 'voice' && !voice.available) || deviceOnlyHidden(s)) return;
  section = s;
  syncHeard();
  ctx.root.querySelectorAll<HTMLElement>('#stGroups button[data-sec]').forEach(b => b.classList.toggle('on', b.dataset.sec === s));
  ctx.root.querySelectorAll<HTMLElement>('.st-sec').forEach(el => el.classList.toggle('on', el.dataset.sec === s));
  $('stContent').scrollTop = 0;
  if (s === 'apps') tabList = null;   // the Android app list is read again each time
  paint();
  if (s === 'wifi' && ctx.isVisible()) scan();
  if (s === 'usage') void loadUsage();
  if (s === 'yourclaude') void loadInstructions();
  if (s === 'plugins') void loadPlugins();
  if (s === 'storage') { void paintStorage(); void paintBackupNote(); }
  if (s === 'security') void paintPinRow();
}

function paint(): void {
  paintSetup();
  switch (section) {
    case 'profile': paintProfile(); break;
    case 'usage': paintUsage(); break;
    case 'yourclaude': paintInstructions(); break;
    case 'sessions': void paintSessions(); break;
    case 'plugins': paintPlugins(); break;
    case 'voice': paintVoice(); break;
    case 'notifications': paintAlerts(); paintNotes(); break;
    case 'wifi': paintWifi(); paintNetworks(); break;
    case 'google': paintGoogle(); break;
    case 'bluetooth': paintBluetooth(); break;
    case 'display': paintDisplay(); break;
    case 'appearance': paintAppearance(); break;
    case 'sound': paintSound(); break;
    case 'battery': paintBattery(); break;
    case 'keyboard': paintKeyboard(); break;
    case 'apps': paintApps(); paintTabApps(); break;
    case 'datetime': paintDateTime(); break;
    case 'privacy': paintPrivacy(); void paintWeatherPlace(); break;
    case 'wellbeing': paintWellbeing(); break;
    case 'about': paintAbout(); void paintUpdate(); break;
    case 'monitor': void paintMonitor(); break;
    case 'developer': paintDeveloper(); break;
    default: break;
  }
}

// ---------- search: filters the rows by their labels and jumps to them ----------
interface Hit { sec: Section; label: string; sub: string; hay: string; el: HTMLElement | null }
let index: Hit[] = [];
let hits: Hit[] = [];
const navName = (s: Section): string => {
  const b = ctx.root.querySelector<HTMLElement>(`#stGroups button[data-sec="${s}"]`);
  return b ? (b.textContent || '').replace(/\d+$/, '').trim() : s;
};
/** Matching ignores case, spaces and punctuation, so "wifi" finds "Wi-Fi" and "24 hour" finds "24-hour". */
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Every row with a label, plus every section, once the page is up (rows are static markup).
 *  A row also matches on its description, so "dark" finds Theme and "bluetooth" finds the Keyboard row that mentions it. */
function buildIndex(): void {
  index = [];
  ctx.root.querySelectorAll<HTMLElement>('.st-sec').forEach(sec => {
    const s = sec.dataset.sec as Section, sub = navName(s);
    if (deviceOnlyHidden(s)) return;
    index.push({ sec: s, label: sub, sub: 'Section', hay: squash(sub), el: null });
    sec.querySelectorAll<HTMLElement>('.st-row > .st-txt > b').forEach(b => {
      const row = b.closest<HTMLElement>('.st-row');
      if (!row || row.closest('.st-allset')) return;
      const label = (b.textContent || '').trim(), detail = row.querySelector('.st-txt > span')?.textContent || '';
      index.push({ sec: s, label, sub, hay: squash(`${label} ${detail} ${sub}`), el: row });
    });
  });
}

/** A row hidden by state (its own `hidden`, or a group above it inside its section) is not a match: a hit must not
 *  jump to a row the user can't see. The section itself may be off screen; jumpTo shows it. */
function rowShown(row: HTMLElement): boolean {
  for (let e: HTMLElement | null = row; e && !e.classList.contains('st-sec'); e = e.parentElement) if (e.hidden) return false;
  return true;
}

function search(q: string): void {
  const needle = squash(q);
  hits = needle ? index.filter(h => h.hay.includes(needle) && (!h.el || rowShown(h.el))).slice(0, 14) : [];
  $('stGroups').hidden = !!needle;
  $('stHits').hidden = !needle;
  $('stSearchText').textContent = needle ? q.trim() : 'Search';
  $('stSearchText').classList.toggle('st-unset', !needle);
  $('stHits').innerHTML = needle
    ? (hits.length ? hits.map((h, i) => `<button class="st-hit hit" data-hit="${i}"><b>${esc(h.label)}</b><span>${esc(h.sub)}</span></button>`).join('')
      : '<div class="st-empty">Nothing matches that.</div>')
    : '';
}

function jumpTo(h: Hit): void {
  search('');
  show(h.sec);
  if (!h.el) return;
  h.el.scrollIntoView({ block: 'center' });
  h.el.classList.add('st-flash');
  setTimeout(() => h.el?.classList.remove('st-flash'), 1400);
}

// ---------- Apps: each app's own settings, like iOS ----------
let appOpen: string | null = null;

function rowHtml(r: SettingRow): string {
  const txt = `<div class="st-txt"><b>${esc(r.title)}</b>${r.detail ? `<span>${esc(r.detail)}</span>` : ''}</div>`;
  if (r.kind === 'choice') {
    const cur = r.get();
    // four or more choices sit on their own line under the text, so the description keeps its width
    return `<div class="st-row${r.options.length > 3 ? ' st-choice' : ''}">${txt}<div class="st-seg" data-choice="${esc(r.id)}">${r.options.map(o =>
      `<button data-v="${esc(o.value)}" class="hit${o.value === cur ? ' on' : ''}">${esc(o.label)}</button>`).join('')}</div></div>`;
  }
  if (r.kind === 'switch') {
    return `<div class="st-row">${txt}<button class="st-switch hit" role="switch" data-switch="${esc(r.id)}" aria-checked="${r.get()}"><i></i></button></div>`;
  }
  if (r.kind === 'action') {
    return `<div class="st-row">${txt}<div class="st-rowbtns">${r.value ? `<span class="st-val">${esc(r.value())}</span>` : ''}`
      + `<button class="st-btn hit" data-action="${esc(r.id)}"${r.disabled?.() ? ' disabled' : ''}>${esc(r.label)}</button></div></div>`;
  }
  return `<div class="st-row">${txt}<span class="st-val">${esc(r.value())}</span></div>`;
}

function paintApps(): void {
  const list = appSettings();
  const open = appOpen ? list.find(a => a.app === appOpen) : null;
  if (!open) {
    appOpen = null;
    $('stApps').innerHTML = `<h2>Apps</h2>`
      + (list.length ? list.map(a => `
        <button class="st-row st-app" data-app="${esc(a.app)}">
          <span class="st-app-ic">${a.icon}</span>
          <div class="st-txt"><b>${esc(a.name)}</b>${a.blurb ? `<span>${esc(a.blurb)}</span>` : ''}</div>
          <span class="st-chev">${CHEV}</span>
        </button>`).join('') : '<div class="st-empty">No apps have settings yet.</div>');
    renderSparks();
    return;
  }
  $('stApps').innerHTML = `<button class="st-back hit" data-back="1">${svg('<path d="M19 9l-7 7 7 7"/>')}Apps</button>`
    + `<h2 class="st-apph"><span class="st-app-ic">${open.icon}</span>${esc(open.name)}</h2>`
    + open.rows().map(rowHtml).join('');
  renderSparks();   // the Claude icon's spark is drawn in after the markup goes in
}

/** Android apps the Launcher shows (moved here from the Launcher app): a switch per app. */
let tabList: AndroidApp[] | null = null;
let tabAllowed = new Set<string>();
let tabFailed = false;   // the last read of the Android app list threw (for example an old APK)
function paintTabApps(): void {
  const box = $('stTabApps');
  if (appOpen || !androidApps.available) { box.innerHTML = ''; return; }
  if (!tabList) {
    try { tabList = androidApps.launchable(); tabAllowed = new Set(androidApps.allowed().map(a => a.id)); tabFailed = false; }
    catch { tabList = []; tabFailed = true; }
  }
  box.innerHTML = `<h3 class="label">Apps on this tablet</h3>`
    + (tabList.length ? tabList.map(a => `
      <div class="st-row st-tabapp">
        <span class="st-app-ic">${a.icon ? `<img src="${esc(a.icon)}" alt="">` : ''}</span>
        <div class="st-txt"><b>${esc(a.name)}</b></div>
        <button class="st-switch hit" data-tabapp="${esc(a.id)}" role="switch" aria-checked="${tabAllowed.has(a.id)}"><i></i></button>
      </div>`).join('') : `<div class="st-empty">${tabFailed ? 'Couldn’t read the apps on this tablet. Check the tablet app is up to date, then try again.' : 'No apps found.'}</div>`)
    + '<p class="st-note-line">Also in Apps › Edit. Switched-on apps show in Apps, beside ClaudeOS’s own apps.</p>';
}

function bindApps(): void {
  $('stApps').addEventListener('click', async e => {
    const t = e.target as HTMLElement;
    const open = appOpen ? appSettings().find(a => a.app === appOpen) : null;
    const appBtn = t.closest<HTMLElement>('[data-app]');
    if (appBtn && !open) { appOpen = appBtn.dataset.app!; report(`settings:app:${appOpen}`); paintApps(); paintTabApps(); $('stContent').scrollTop = 0; return; }
    if (t.closest('[data-back]')) { appOpen = null; paintApps(); paintTabApps(); return; }
    if (!open) return;
    const rows = open.rows();
    const choice = t.closest<HTMLElement>('[data-choice] button');
    const sw = t.closest<HTMLElement>('[data-switch]');
    const act = t.closest<HTMLElement>('[data-action]');
    try {
      if (choice) {
        const r = rows.find(x => x.id === choice.parentElement!.dataset.choice);
        if (r?.kind === 'choice') { await r.set(choice.dataset.v!); report(`settings:${open.app}:${r.id}`); }
      } else if (sw) {
        const r = rows.find(x => x.id === sw.dataset.switch);
        if (r?.kind === 'switch') await r.set(!r.get());
      } else if (act) {
        const r = rows.find(x => x.id === act.dataset.action);
        if (r?.kind === 'action') r.run();
      }
    } catch (err) { confirmSheet('Couldn’t change it', (err as Error).message || 'Something went wrong.', 'OK', () => {}); }
    paintApps();
  });
  $('stTabApps').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tabapp]');
    if (!b) return;
    const id = b.dataset.tabapp!;
    // re-read first: the tablet's allowed list can change after paintTabApps cached it (the Launcher's Add apps sheet saves too)
    try { tabAllowed = new Set(androidApps.allowed().map(a => a.id)); }
    catch { confirmSheet('Couldn’t change it', 'Couldn’t read the tablet’s apps, so nothing changed. Try again.', 'OK', () => {}); return; }
    const before = new Set(tabAllowed);
    tabAllowed.has(id) ? tabAllowed.delete(id) : tabAllowed.add(id);
    try { androidApps.setAllowed([...tabAllowed]); report('settings:apps:launcher'); }
    catch { tabAllowed = before; confirmSheet('Couldn’t change it', 'Check the tablet app is up to date, then try again.', 'OK', () => {}); }
    paintTabApps();
  });
  onAppSettingsChange(() => { if (section === 'apps') paintApps(); else if (section === 'usage' && onTablet) paintUsage(); });
}

/** Open Settings → Apps → one app's page (apps can link here, e.g. a gear in their header). */
function openAppSettings(app: string): void { appOpen = app; show('apps'); }

// ---------- Profile: the name, what Claude calls you, your work, and a photo (kept on the PC) ----------
const AVATAR_COLOURS = ['var(--clay)', 'var(--blue)', 'var(--olive)', 'var(--clay-deep)'];
const PERSON = svg('<circle cx="16" cy="12.5" r="5"/><path d="M7 27c1.4-5 4.8-7.5 9-7.5s7.6 2.5 9 7.5"/>');

function paintProfile(): void {
  const p = profile(), letters = initials(p.name), av = $('stAvatar');
  if (p.photoAt) { av.innerHTML = `<img src="/api/settings/photo?v=${p.photoAt}" alt="">`; av.style.background = ''; }
  else if (letters) {
    // the colour is the name's own: the same name always gets the same circle
    const hash = [...p.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
    av.innerHTML = `<span>${esc(letters)}</span>`;
    av.style.background = AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
  }
  else { av.innerHTML = PERSON; av.style.background = ''; }
  av.classList.toggle('bare', !p.photoAt && !letters);
  $('stPhotoRemove').hidden = !p.photoAt;
  const field = (id: string, v: string) => { const el = $(id); el.textContent = v || 'Not set'; el.classList.toggle('st-unset', !v); };
  field('stNameVal', p.name); field('stNickVal', p.nickname); field('stRoleVal', p.role);
}

/** A name or nickname, typed on the tablet's own keyboard, then saved to the PC on Done. */
function editName(key: 'name' | 'nickname'): void {
  const p = profile();
  Keyboard.open({
    value: key === 'name' ? p.name : p.nickname,
    placeholder: key === 'name' ? 'Your full name' : 'What Claude should call you',
    done: 'Save', autoCap: true,
    max: key === 'name' ? NAME_MAX : NICK_MAX,
    onDone: text => { void saveProfile({ [key]: text.trim() }); },
  });
}

// a profile save the PC never answers gives up; each save takes a number, and only the newest save is shown
const PROFILE_TIMEOUT_MS = 20e3;
let profileSaveSeq = 0;
async function saveProfile(fields: Partial<Record<'name' | 'nickname' | 'role', string>>): Promise<void> {
  const seq = ++profileSaveSeq;
  try {
    const r = await postJson<Partial<Profile>>('/api/settings/profile', fields, PROFILE_TIMEOUT_MS);
    if (seq !== profileSaveSeq) return;   // a newer save came first: its answer is the one that counts
    if (typeof r.name !== 'string') throw new Error('not saved');
    applyProfile(r as Profile);
    report('settings:profile');
  } catch { if (seq !== profileSaveSeq) return; confirmSheet('Couldn’t save', 'Check the connection to your PC, then try again.', 'OK', () => {}); }
}

function paintRoles(): void {
  const cur = profile().role;
  const rows: [string, string][] = [['', 'Not set'], ...ROLES.map(r => [r, r] as [string, string])];
  $('stRoleList').innerHTML = rows.map(([v, label]) => `
    <button class="st-pick-row hit${v === cur ? ' on' : ''}" data-role="${esc(v)}">
      <span class="st-radio"></span><span class="st-txt"><b>${esc(label)}</b></span>
    </button>`).join('');
}

// the photo list the PC never answers gives up; a read for a sheet that was closed, or a newer open, does not fill the grid
const PHOTOS_TIMEOUT_MS = 20e3;
let photoSheetSeq = 0;
async function openPhotoSheet(): Promise<void> {
  const seq = ++photoSheetSeq;
  const grid = $('stPhotoGrid');
  $('stPhotoSheet').hidden = false;
  $('stPhotoEmpty').hidden = true;
  grid.innerHTML = '<div class="st-empty">Loading your photos…</div>';
  let photos: { id: string; url: string }[] = [];
  let failed: string | null = null;
  try {
    const r = await getJson<{ ok: boolean; days?: { photos: { id: string; url: string }[] }[]; error?: string }>('/api/photos/list?limit=120', PHOTOS_TIMEOUT_MS);
    if (seq !== photoSheetSeq || $('stPhotoSheet').hidden) return;   // closed, or a newer open came first
    if (r.ok !== true) failed = typeof r.error === 'string' && r.error ? r.error : 'Your photos didn’t load. ClaudeOS can’t reach the PC.';
    else photos = (r.days ?? []).flatMap(d => d.photos).slice(0, 120);
  } catch { if (seq !== photoSheetSeq || $('stPhotoSheet').hidden) return; failed = 'Your photos didn’t load. ClaudeOS can’t reach the PC.'; }
  // the note says "no photos" only when the list loaded and is empty
  const empty = $('stPhotoEmpty');
  empty.textContent = failed ?? 'No photos yet. Take one with the Camera or add one in Photos.';
  empty.hidden = failed === null && photos.length > 0;
  // a thumbnail to choose from; usePhoto crops from the same thumbnail (400 px is enough for the 256 px profile photo)
  grid.innerHTML = photos.map(p => `<button class="st-photo-thumb hit" data-photo="${esc(thumbUrl(p.id))}" aria-label="Use this photo"><img src="${esc(thumbUrl(p.id))}" alt="" loading="lazy"></button>`).join('');
}

/** The sentence for a photo the PC did not save. `error` is the error code from server/profile.ts, or its text. */
function photoErrorText(error: unknown): string {
  if (error === 'too_big') return 'That photo is too big. Try another photo.';
  if (error === 'not_jpeg') return 'That photo isn’t a JPEG. Try another photo.';
  if (error === 'no_photo') return 'No photo reached your PC. Try again.';
  return typeof error === 'string' && error ? error : 'Try another photo, or try again.';
}

/** Crop a photo from the library to a 256 px square (the middle of it), and keep it as the profile photo. */
async function usePhoto(url: string): Promise<void> {
  photoSheetSeq++;   // a photo list still out is for a sheet that is now closed
  $('stPhotoSheet').hidden = true;
  // stage 1: the tablet decodes and crops the photo. A failure here is the photo's fault.
  let blob: Blob | null = null;
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight), sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    c.getContext('2d')!.drawImage(img, sx, sy, side, side, 0, 0, 256, 256);
    blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', .88));
  } catch { blob = null; }
  if (!blob) { confirmSheet('Couldn’t use that photo', 'Try another photo, or try again.', 'OK', () => {}); return; }
  // stage 2: the PC saves the photo. A fetch that throws or a non-JSON answer means the PC cannot be reached.
  let j: { ok?: boolean; profile?: Profile; error?: unknown } | null;
  try {
    const r = await fetch('/api/settings/photo', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
    j = await r.json() as { ok?: boolean; profile?: Profile; error?: unknown } | null;
  } catch { j = null; }
  if (j === null) { confirmSheet('Couldn’t use that photo', 'Check the connection to your PC, then try again.', 'OK', () => {}); return; }
  // stage 3: the PC answered. Its reason says what to change.
  if (!j.ok || !j.profile) { confirmSheet('Couldn’t use that photo', photoErrorText(j.error), 'OK', () => {}); return; }
  applyProfile(j.profile);
  report('settings:profile:photo');
}

/** Remove the profile photo. The PC answers with the full profile; anything else keeps the profile as it is. */
async function removePhoto(): Promise<void> {
  let r: (Partial<Profile> & { error?: unknown }) | null;
  try { r = await postJson<(Partial<Profile> & { error?: unknown }) | null>('/api/settings/photo/remove', {}); }
  catch { confirmSheet('Couldn’t remove it', 'Check the connection to your PC, then try again.', 'OK', () => {}); return; }
  // the PC answered without a profile: say why, and do not apply anything
  if (!r || typeof r.name !== 'string') {
    const why = r && typeof r.error === 'string' && r.error ? r.error : 'The PC did not remove the photo. Try again.';
    confirmSheet('Couldn’t remove it', why, 'OK', () => {});
    return;
  }
  applyProfile(r as Profile);
  report('settings:profile:photo:remove');
}

// ---------- Usage: the plan's limits, as bars ----------
// On the tablet: from the tablet's own Claude CLI (apps/claude/web/native.ts), never the PC hub. The latest limits a
// native chat saw are shown at once; when they are older than USAGE_MAX_AGE (or there are none), a short CLI check runs.
// Off the tablet (a browser on the PC): the hub's usage check (apps/claude/server/limits.ts).
const USAGE_MAX_AGE = 10 * 60e3;
let usage: Usage | null = null;
let usageFailed = false;   // the last PC read failed; `usage` then holds the last good read, if any
async function loadUsage(): Promise<void> {
  if (onTablet) { checkUsage(USAGE_MAX_AGE); if (section === 'usage') paintUsage(); return; }
  try { usage = await getJson<Usage>('/api/claude/usage'); usageFailed = false; } catch { usageFailed = true; }
  if (section === 'usage') paintUsage();
}

function resetText(iso: string | null): string {
  const at = iso ? new Date(iso) : null;
  return at && Number.isFinite(+at)
    ? `Resets ${at.toDateString() === new Date().toDateString() ? clock(at) : whenText(at)} · in ${untilText(+at - Date.now())}`
    : 'Starts with your next message';
}

function usageRowHtml(name: string, used: number | null, state: string, resetsAt: string | null): string {
  if (used == null) {   // the CLI sent no utilization for this window: its status and reset time only
    return `<div class="st-usage">
      <div class="st-usage-top"><b>${esc(name)}</b><span class="num">${esc(state)}</span></div>
      <div class="st-usage-sub">${esc(resetText(resetsAt))}</div>
    </div>`;
  }
  const pct = Math.max(0, Math.min(100, Math.round(used)));
  return `<div class="st-usage${pct >= 90 ? ' hot' : ''}">
    <div class="st-usage-top"><b>${esc(name)}</b><span class="num">${pct}% used</span></div>
    <div class="st-bar st-bar-usage"><i style="width:${pct}%"></i></div>
    <div class="st-usage-sub">${esc(resetText(resetsAt))}</div>
  </div>`;
}

function paintTabletUsage(): void {
  const box = $('stUsageRows'), note = $('stUsageNote');
  const limits = nativeLimits(), rows = usageRows(limits), check = usageCheck();
  if (rows.length) box.innerHTML = rows.map(r => usageRowHtml(r.name, r.used, r.state, r.resetsAt)).join('');
  else {
    const msg = check.running ? 'Checking your usage on this tablet…'
      : !usageCheckable() ? 'Update the ClaudeOS app to check your usage here.'
      : device.cliAuthState().signedIn === 0 ? 'Sign in to Claude under Settings → Apps → Claude to see your usage here.'
      : check.failed ? 'Couldn’t check your usage. Try again in a minute.'
      : 'No usage to show yet.';
    box.innerHTML = `<div class="st-empty">${esc(msg)}</div>`;
  }
  const updated = limitsUpdated(limits);
  const upd = updated ? new Date(updated) : null;
  note.textContent = [upd ? `Updated ${upd.toDateString() === new Date().toDateString() ? clock(upd) : whenText(upd)}` : '', rows.length && check.running ? 'Checking…' : '',
    rows.length && !check.running && check.failed ? 'Couldn’t check again' : ''].filter(Boolean).join(' · ');
}

function paintUsage(): void {
  if (onTablet) { paintTabletUsage(); return; }
  const box = $('stUsageRows'), note = $('stUsageNote');
  if (!usage) {   // no read has finished yet: say so, unless the read failed
    box.innerHTML = usageFailed ? '<div class="st-empty">Couldn’t reach your PC to check your usage.</div>'
      : '<div class="st-empty">Checking your usage…</div>';
    note.textContent = ''; return;
  }
  const L: Limits = usage.limits;
  const rows: [string, LimitWindow | undefined][] = [['Current session', L.limits.five_hour], ['Weekly, all models', L.limits.seven_day]];
  for (const e of L.list.filter(x => x.kind === 'weekly_scoped' && x.model)) rows.push([`Weekly · ${e.model}`, { used: e.percent, resets_at: e.resets_at }]);
  const shown = rows.filter((r): r is [string, LimitWindow] => !!r[1] && r[1].used != null);
  if (!shown.length) {
    box.innerHTML = L.status === 'no_token'
      ? '<div class="st-empty">Sign in to Claude on your PC to see your usage here.</div>'
      : `<div class="st-empty">${esc(L.error || 'No usage to show yet.')}</div>`;
  } else {
    box.innerHTML = shown.map(([name, w]) => {
      const pct = Math.max(0, Math.min(100, Math.round(w.used ?? 0)));
      const at = w.resets_at ? new Date(w.resets_at) : null;
      const when = at ? `Resets ${at.toDateString() === new Date().toDateString() ? clock(at) : whenText(at)} · in ${untilText(+at - Date.now())}` : 'Starts with your next message';
      return `<div class="st-usage${pct >= 90 ? ' hot' : ''}">
        <div class="st-usage-top"><b>${esc(name)}</b><span class="num">${pct}% used</span></div>
        <div class="st-bar st-bar-usage"><i style="width:${pct}%"></i></div>
        <div class="st-usage-sub">${esc(when)}</div>
      </div>`;
    }).join('');
  }
  if (usageFailed) { note.textContent = 'Couldn’t reach your PC. Usage may be out of date.'; return; }
  note.textContent = L.updated ? `Updated ${whenText(new Date(L.updated))}${L.error ? ` · ${L.error}` : ''}` : (L.error || '');
}

// ---------- Your Claude: instructions for every new session (kept on the PC) ----------
let instructions = '';
let instructionsLoaded = false;
let instructionsFailed = false;
let instructionsReadFailed = false;   // the PC answered, but its file of instructions cannot be read
// a read the PC never answers gives up; each read takes a number, and only the newest one (or a save) sets the instructions
const INSTR_TIMEOUT_MS = 20e3;
let instrSeq = 0;
async function loadInstructions(): Promise<void> {
  const seq = ++instrSeq;
  try {
    const r = await fetch('/api/settings/instructions', { cache: 'no-store', signal: AbortSignal.timeout(INSTR_TIMEOUT_MS) });
    if (!r.ok) throw new Error(`PC answered ${r.status}`);
    const d = (await r.json()) as { text: string; error?: string };
    if (seq !== instrSeq) return;   // a newer read, or a save, came first
    instructionsReadFailed = !!d.error;
    instructions = d.error ? '' : d.text || ''; instructionsLoaded = true; instructionsFailed = false;
  } catch { if (seq !== instrSeq) return; instructionsFailed = true; /* keep what we have */ }
  if (section === 'yourclaude') paintInstructions();
}
function paintInstructions(): void {
  const v = $('stInstrVal');
  if (instructionsReadFailed) {
    // Never the "Add instructions" prompt: that would invite the user to type over the saved file.
    v.textContent = 'Not available right now.';
    v.classList.add('st-unset');
    $('stInstrNote').textContent = INSTRUCTIONS_READ_FAILED;
    return;
  }
  v.textContent = instructions || 'Add instructions, like “Keep answers short” or “I’m planning a trip to Lisbon”.';
  v.classList.toggle('st-unset', !instructions);
  $('stInstrNote').textContent = instructionsLoaded
    ? (instructionsFailed ? 'Couldn’t reach your PC, so these may be out of date.' : 'Tap to write them. Claude follows them in sessions you start from now on.')
    : instructionsFailed ? 'Couldn’t reach your PC. Your instructions show when it’s back.' : 'Checking your PC…';
}
async function editInstructions(): Promise<void> {
  if (!instructionsLoaded || instructionsFailed || instructionsReadFailed) {
    await loadInstructions();
    if (instructionsReadFailed) { confirmSheet(INSTRUCTIONS_READ_FAILED, 'Editing is off until it can be read. Try again later.', 'OK', () => {}); return; }
    if (!instructionsLoaded || instructionsFailed) { confirmSheet('Couldn’t reach your PC', 'Try again when it is back on.', 'OK', () => {}); return; }
  }
  Keyboard.open({
    value: instructions, placeholder: 'How Claude should work with you', done: 'Save', autoCap: true, max: INSTRUCTIONS_MAX,
    onDone: text => { void saveInstructions(text); },
  });
}
async function saveInstructions(text: string): Promise<void> {
  try {
    const r = await postJson<{ text: string; ok?: boolean }>('/api/settings/instructions', { text: text.trim() }, INSTR_TIMEOUT_MS);
    if (r.ok === false) throw new Error('not saved');   // the PC kept the old text: say so, do not clear the box
    instrSeq++;   // a read still out is older than this save: it must not bring the old text back
    instructions = r.text || ''; instructionsLoaded = true; instructionsReadFailed = false; instructionsFailed = false;
    report('settings:instructions');
  } catch { confirmSheet('Couldn’t save', 'Check the connection to your PC, then try again.', 'OK', () => {}); }
  paintInstructions();
}

// ---------- Sessions: the defaults for a new session (the composer's choices start from these) ----------
interface Choice { id: string; label: string; sub?: string }
let chooseHandler: ((id: string) => void) | null = null;
/** A short list to pick one thing from, in the shared sheet. */
function openChooser(title: string, intro: string, items: Choice[], current: string, onPick: (id: string) => void): void {
  $('stChooseTitle').textContent = title;
  $('stChooseIntro').textContent = intro;
  $('stChooseList').innerHTML = items.map(i => `
    <button class="st-pick-row hit${i.id === current ? ' on' : ''}" data-choose="${esc(i.id)}">
      <span class="st-radio"></span><span class="st-txt"><b>${esc(i.label)}</b>${i.sub ? `<span>${esc(i.sub)}</span>` : ''}</span>
    </button>`).join('');
  $('stChooseList').scrollTop = 0;
  chooseHandler = onPick;
  $('stChoose').hidden = false;
}

const MODE_CHOICES: Choice[] = [
  { id: 'auto', label: 'Auto', sub: 'Claude handles permission decisions' },
  { id: 'default', label: 'Manual', sub: 'Always ask before making changes' },
  { id: 'acceptEdits', label: 'Accept edits', sub: 'Automatically accept all file edits' },
  { id: 'plan', label: 'Plan', sub: 'Create a plan before making changes' },
];
const MODE_NAME: Record<string, string> = Object.fromEntries(MODE_CHOICES.map(c => [c.id, c.label]));
let projects: Project[] | null = null;
let foldersFailed = false;   // the last folder read did not reach the PC (not: the PC has none)

// The Default folder value. A saved folder that is missing from a good read says Unavailable.
// A failed read says the PC is unreachable, and an unfinished read says Loading.
function folderLabel(fid: string): string {
  if (!fid) return 'Most recent';
  const found = projects?.find(p => p.id === fid);
  if (found) return found.name;
  if (foldersFailed) return 'Can’t reach the PC';
  if (!projects) return 'Loading…';
  return 'Unavailable';
}

// the default model and folder reads give up on a PC that does not answer; a repaint that is no longer the newest does nothing
const SESSIONS_TIMEOUT_MS = 20e3;
let foldersSeq = 0;
async function paintSessions(): Promise<void> {
  const seq = ++foldersSeq;
  const mid = newPref('model'), mode = newPref('mode') || 'default', fid = newFolderPref();
  $('stNewModelV').textContent = mid ? (modelChoices().find(m => m.id === mid)?.label ?? mid) : 'Automatic';
  $('stNewModeV').textContent = MODE_NAME[mode] ?? 'Manual';
  $('stNewFolderV').textContent = folderLabel(fid);
  await loadModels();   // the models this PC's Claude offers (cached on the tablet)
  if (section === 'sessions') $('stNewModelV').textContent = mid ? (modelChoices().find(m => m.id === mid)?.label ?? mid) : 'Automatic';
  // read again each time: a folder added or removed on the PC shows at once; a failed read keeps the last good list
  try {
    const p = await getJson<Project[]>('/api/claude/projects', SESSIONS_TIMEOUT_MS);
    if (seq !== foldersSeq) return;   // a newer repaint came first: its folder list is the one that counts
    projects = p; foldersFailed = false;
  } catch { if (seq !== foldersSeq) return; foldersFailed = true; }
  if (section === 'sessions') $('stNewFolderV').textContent = folderLabel(newFolderPref());
}

function pickModel(): void {
  const models: ModelChoice[] = modelChoices();
  openChooser('Default model', 'The model a new session uses. You can still change it for any one session.',
    [{ id: '', label: 'Automatic', sub: 'Claude Code’s own default model' }, ...models.map(m => ({ id: m.id, label: m.label, sub: m.description || undefined }))],
    newPref('model'), id => { setNewPref('model', id); report('settings:sessions:model'); void paintSessions(); });
}
function pickMode(): void {
  openChooser('Default permission mode', 'How much Claude does on its own in a new session.', MODE_CHOICES, newPref('mode') || 'default',
    id => { setNewPref('mode', id as HubPermission); report('settings:sessions:mode'); void paintSessions(); });
}
function pickFolder(): void {
  const list = projects ?? [];
  openChooser('Default folder', foldersFailed ? 'Can’t reach your PC just now. Open Sessions again to retry.' : 'The folder a new session opens in.',
    [{ id: '', label: 'Most recent', sub: 'The folder you used last' }, ...list.map(p => ({ id: p.id, label: p.name }))],
    newFolderPref(), id => { setNewFolderPref(id); report('settings:sessions:folder'); void paintSessions(); });
}

// ---------- Notifications: chime, critter, banner or off, for each thing that needs you ----------
function paintAlerts(): void {
  const a = prefs.alerts;
  setSeg('alert-done', a.done);
  setSeg('alert-approval', a.approval);
  setSeg('alert-timer', a.timer);
  setSeg('alert-event', a.event);
  setSwitch('stBanners', prefs.banners);
}

// ---------- Voice ----------
function paintSttFn(): void {
  let s = null;
  try { s = voice.stt(); } catch { /* ignore */ }
  $('stSttRow').hidden = !s;
  $('stCloudSttRow').hidden = !s || !s.standard;
  if (!s) return;
  setSwitch('stCloudStt', s.cloud);
  const needPack = s.onDevice && (s.onDeviceEnglish === 'downloadable' || s.onDeviceEnglish === 'missing');
  $('stSttDl').hidden = !needPack || s.onDeviceEnglish === 'missing';
  const fallback = s.using === 'cloud' ? 'Google, online' : 'the basic recogniser on this tablet';
  $('stSttNote').textContent =
    s.using === 'device' ? 'Speech recognition on this tablet: what you say never leaves it.'
    : s.onDevice && s.onDeviceEnglish === 'pending' ? `Downloading the English speech pack… Until then: ${fallback}.`
    : needPack ? `The tablet can do this once its English speech pack is downloaded. Until then: ${fallback}.`
    : s.using === 'cloud' ? 'Google speech recognition, online: what you say after “Hey Claude” is sent to Google.'
    : 'The basic recogniser on this tablet (less accurate). Nothing leaves the tablet.';
}

function paintVoice(): void {
  if (!voice.available) return;
  let st = null;
  try { st = voice.state(); } catch { /* ignore */ }
  setSwitch('stWake', !!st?.wake);
  $('stWakeNote').textContent = prefs.wakePaused
    ? 'Paused for quiet hours or low power. It comes back when they end.'
    : st && !st.permission && !st.wake
      ? 'Listens on this tablet only. The tablet asks for the microphone the first time.'
      : st?.error ? `Listens on this tablet only. ${st.error}`
      : 'Listens on this tablet only. Nothing is recorded or sent until you say “Hey Claude”.';
  paintSttFn();
  let list = null;
  try { list = voice.voices(); } catch { /* ignore */ }
  const current = list?.voices.find(v => v.id === list?.voice);
  const using = list?.voices.find(v => v.id === list?.using);
  $('stVoiceName').textContent = current ? current.label : 'Automatic';
  $('stVoiceNote').textContent = list && !list.ready ? 'How Claude sounds when it answers out loud. The tablet’s voices are still loading.'
    : using ? `How Claude sounds when it answers out loud. Speaking with: ${using.label}${using.network ? ' (sends the text to Google)' : ''}.`
    : 'How Claude sounds when it answers out loud.';
  setSwitch('stNatural', !!list?.natural);
  const lang = chosenLang(list);
  $('stVoiceLangName').textContent = lang ? langName(lang) : 'The tablet’s language';
  setSeg('voicestyle', String(list?.pitch ?? 1));
  gateRow($('stVoiceLangRow'), voice.has('setVoiceLanguage'));
  gateRow($('stVoiceStyleRow'), voice.has('setVoicePitch'));
  setSwitch('stCritterSpeak', prefs.critterSpeaks);
  $('stNaturalNote').textContent = 'More lifelike voices from Google. They send the spoken text to Google to be voiced; on-device voices never leave this tablet.'
    + (list && list.online === false ? ' No internet right now, so it’s using an on-device voice.' : ' Without internet it uses an on-device voice.');
  const rate = list?.rate || 1;
  if (document.activeElement !== $('stRate')) paintSlider('stRate', rate, rateText(rate));   // the slider runs 50–200, i.e. rate × 100
  const muted = mediaVolume() === 0;
  $('stTestNote').textContent = muted ? 'Media volume is off, so you won’t hear it. Playing turns it up to half.' : 'Plays a short sample at the media volume.';
  $('stTestNote').classList.toggle('st-err', muted);
  $('stTest').textContent = muted ? 'Turn up & play' : 'Play sample';
}

// "Last heard": what the wake word recogniser made of the room lately (text only), and a live mic level.
const METER_BARS = 30;
function paintHeard(): void {
  let d = null;
  try { d = voice.diag(); } catch { /* ignore */ }
  const row = $('stHeardRow');
  row.hidden = !d;
  if (!d) return;
  const meter = $('stMeter');
  if (meter.childElementCount !== METER_BARS) meter.innerHTML = '<i></i>'.repeat(METER_BARS);
  const lv = d.levels.slice(-METER_BARS);
  meter.querySelectorAll('i').forEach((b, i) => {
    const v = lv[i] ?? 0;
    (b as HTMLElement).style.height = `${Math.max(6, Math.min(100, v * 160))}%`;
    b.classList.toggle('hot', v > Math.max(.18, (d.floor ?? 0) * 1.5));   // clay: clearly above the room's own noise
  });
  const ago = (at: number) => { const s = Math.round((Date.now() - at) / 1000); return s < 5 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`; };
  const last = d.heard.slice(-3).reverse();
  $('stHeard').innerHTML = d.mode !== 'wake' && d.mode !== 'listen' && d.mode !== 'speaking'
    ? 'Not listening right now. Switch on “Hey Claude” above.'
    : last.length ? last.map(h => `${h.woke ? '<b>' : ''}“${esc(h.text)}”${h.woke ? '</b> → woke up' : ''} <small>${ago(h.at)}</small>`).join(' · ')
    : 'Nothing yet. Say “Hey Claude” and watch here.';
  const noisy = (d.floor ?? 0) > .14;
  $('stHeardFx').textContent = `${d.effects}${d.floor != null ? ` · room noise ${d.floor.toFixed(2)}` : ''}`
    + (d.peak < .08 ? ' · very quiet: speak up, or come closer' : noisy ? ' · noisy room: speak up a little, or turn the TV down' : '');
}

// The picker: Automatic, then "Natural (needs internet)" and "On this tablet". Your language and English
// are listed; "Show all languages" adds the rest. Tapping a voice plays a short sample and chooses it.
let pickAll = false;
let previewing: string | null = null;   // the voice whose sample is playing ('' = Automatic)
const VOICE_SAMPLE = 'Hi, I’m Claude. This is how I’ll sound when I answer you.';

/** A language code as its name in English, e.g. "fr" → "French", "en-GB" → "British English". */
function langName(tag: string): string {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) || tag; } catch { return tag; }
}

/** The spoken language Settings shows: '' = the tablet's own, else the chosen language's code. */
function chosenLang(list: { lang?: string } | null): string {
  const tablet = (navigator.language || 'en').split('-')[0].toLowerCase();
  const lang = (list?.lang || '').split('-')[0].toLowerCase();
  return !lang || lang === tablet ? '' : lang;
}

/** Spoken language: the tablet's own, or one of the languages the voices come in (a chooser sheet). */
function pickLanguage(): void {
  let list = null;
  try { list = voice.voices(); } catch { /* ignore */ }
  const byLang = new Map<string, string[]>();
  for (const v of list?.voices ?? []) {
    const lang = v.language || v.locale.split('-')[0];
    const tags = byLang.get(lang) ?? [];
    if (!tags.includes(v.locale)) tags.push(v.locale);
    byLang.set(lang, tags);
  }
  const items: Choice[] = [{ id: '', label: 'The tablet’s language', sub: navigator.language || 'en' }];
  [...byLang.entries()].sort((a, b) => langName(a[0]).localeCompare(langName(b[0])))
    .forEach(([lang, tags]) => items.push({ id: lang, label: langName(lang), sub: tags.join(', ') }));
  openChooser('Spoken language', 'Claude speaks in this language, and the voice list shows its voices.', items, chosenLang(list), id => {
    try { voice.setLanguage(id); } catch (e) { confirmSheet('Couldn’t change it', (e as Error).message, 'OK', () => {}); }
    report(`settings:voice:lang:${id || 'tablet'}`);
    paintVoice();
  });
}

function paintPicker(): void {
  let list = null;
  try { list = voice.voices(); } catch { /* ignore */ }
  const cur = list?.voice || '';
  const here = (list?.lang || navigator.language || 'en-US').toLowerCase(), mine = here.split('-')[0];
  const all = list?.voices || [];
  // your own accent first (en-US on a US tablet), keeping the tablet's order otherwise
  const rank = (v: { locale: string }) => (v.locale.toLowerCase() === here ? 0 : 1);
  const shown = all.filter(v => pickAll || !v.language || v.language === mine || v.language === 'en')
    .map((v, i) => ({ v, i })).sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i).map(x => x.v);
  const row = (id: string, label: string, sub: string, play = true) => `
    <button class="st-pick-row${id === cur ? ' on' : ''}${id === previewing ? ' playing' : ''}" data-voice="${esc(id)}">
      <span class="st-radio"></span><span class="st-txt"><b>${esc(label)}</b><span>${esc(sub)}</span></span>${play ? `<span class="st-play">${PLAY}</span>` : ''}
    </button>`;
  const natural = shown.filter(v => v.network), local = shown.filter(v => !v.network);
  const offline = list?.online === false;
  let html = row('', 'Automatic', list?.natural ? 'A natural voice when online, otherwise one on this tablet' : 'The tablet’s own default voice');
  if (natural.length) {
    html += `<div class="st-pick-group label">Natural (needs internet)<span>Lifelike voices from Google. The spoken text is sent to Google to be voiced.${offline ? ' No internet right now: an on-device voice stands in.' : ''}</span></div>`
      + natural.map(v => row(v.id, v.label, `${v.locale}${offline ? ' · offline now' : ''}`)).join('');
  }
  html += `<div class="st-pick-group label">On this tablet<span>Nothing leaves the tablet.</span></div>`
    + local.map(v => row(v.id, v.label, `${v.locale}${v.installed ? '' : ' · downloads from Google when chosen'}`)).join('');
  if (!pickAll && shown.length < all.length) html += `<button class="st-pick-more hit" data-all="1">Show all languages (${all.length - shown.length} more)</button>`;
  if (list && !list.ready) html += '<div class="st-empty">More voices appear once the tablet has loaded them.</div>';
  const box = $('stPickList'), top = box.scrollTop;
  box.innerHTML = html;
  box.scrollTop = top;
}

const rateText = (r: number) => `${r.toFixed(r * 100 % 10 ? 2 : 1)}×`;
function mediaVolume(): number { try { return device.volume().media; } catch { return 1; } }

// ---------- Notifications: the Recent list ----------
function paintNotes(): void {
  const list = notifications();
  $('stNotesClear').hidden = !list.length;
  $('stNotes').innerHTML = list.length ? groupedNotesHtml(list, 'st-nrow')
    : '<div class="st-empty">Nothing here. When Claude needs you, or a timer or alarm goes off, it shows up here.</div>';
  // one switch per app that has sent a notice (or is muted): on means its chimes, speech and banners are off
  const muted = mutedApps();
  const apps = [...new Set([...list.map(n => n.app || '').filter(Boolean), ...muted])];
  $('stMuted').innerHTML = apps.length ? apps.map(a => {
    const off = muted.includes(a);
    return `<div class="st-row"><div class="st-txt"><b>${esc(appLabel(a))}</b><span>${off ? 'Muted: notices go to Recent only' : 'Chimes, speech and banners on'}</span></div>`
      + `<button class="st-switch hit" role="switch" aria-checked="${off ? 'false' : 'true'}" data-mute="${esc(a)}" aria-label="Show alerts from ${esc(appLabel(a))}"><i></i></button></div>`;
  }).join('') : '<div class="st-empty">Apps that send notices show here, so you can mute one.</div>';
}

// ---------- Network (Wi-Fi) ----------
const wifiIcon = (bars: number, secure: boolean): string => svg(
  `<path d="M5 13a16 16 0 0 1 22 0" stroke="${bars >= 4 ? 'currentColor' : 'var(--t5)'}"/>`
  + `<path d="M9 17.5a10 10 0 0 1 14 0" stroke="${bars >= 3 ? 'currentColor' : 'var(--t5)'}"/>`
  + `<path d="M13 22a4 4 0 0 1 6 0" stroke="${bars >= 2 ? 'currentColor' : 'var(--t5)'}"/><circle cx="16" cy="25.5" r=".8" fill="currentColor"/>`
  + (secure ? '<rect x="22" y="21" width="7" height="6" rx="1.2" fill="currentColor" stroke="none"/><path d="M23.5 21v-1.5a2 2 0 0 1 4 0V21" stroke-width="1.6"/>' : ''));

let wifiNow: WifiState | null = null;
/** The Google accounts on this tablet, by name. Read on each open of the section. */
function paintGoogle(): void {
  const list = $('stGoogleList');
  let accounts: { name: string }[] = [];
  try { accounts = device.googleAccounts().accounts ?? []; }
  catch (e) { list.innerHTML = `<div class="st-empty">${esc((e as Error).message)}</div>`; return; }
  list.innerHTML = accounts.length
    ? accounts.map(a => `<div class="st-row"><div class="st-txt"><b>${esc(a.name)}</b><span>Signed in on this tablet</span></div></div>`).join('')
    : '<div class="st-empty">No Google account is on this tablet yet.</div>';
}

/** Starts Google's sign-in. Google's own screen takes over the tablet until the user finishes it. */
/** Asks the tablet for a read-only Google token for calendar and for email, and says what it found. No token is shown. */
function checkGoogleAccess(): void {
  const parts: string[] = [];
  for (const which of ['calendar', 'gmail'] as const) {
    const name = which === 'calendar' ? 'Calendar' : 'Email';
    try {
      const r = device.googleCheck(which);
      parts.push(`${name}: ${r.ok ? 'works' : r.consent ? 'needs a one-time approval' : 'not yet'}`);
    } catch (e) { parts.push(`${name}: ${(e as Error).message}`); }
  }
  $('stGoogleNote').textContent = parts.join('. ') + '.';
}

function openGoogleSignIn(): void {
  try { device.addGoogleAccount(); $('stGoogleNote').textContent = 'Finish signing in, then come back to this page.'; }
  catch (e) { $('stGoogleNote').textContent = `Couldn’t open sign-in: ${(e as Error).message}`; }
}

function paintWifi(): void {
  try {
    const w = wifiNow = device.wifi();
    setSwitch('stWifiOn', w.enabled);
    if (w.ssid && w.ssid === joining) { joining = null; joinErrors.delete(w.ssid); }
    $('stWifiNow').textContent = !w.enabled ? 'Off. ClaudeOS needs Wi-Fi to reach your PC.'
      : w.ssid ? 'On' : joining ? `Joining ${joining}…` : 'On, not connected to a network.';
    $('stWifiCurrent').innerHTML = w.enabled && w.ssid ? `
      <div class="st-current">
        <span class="st-current-ic">${wifiIcon(w.bars ?? 4, false)}</span>
        <div class="st-txt"><b>${esc(w.ssid)}</b><span>Connected${w.mbps ? ` · ${w.mbps} Mbps` : ''}${w.ip ? ` · ${esc(w.ip)}` : ''}</span></div>
        <button class="st-btn hit ghost" data-forget="${esc(w.ssid)}">Forget</button>
      </div>` : '';
    $('stWifiOthers').hidden = !w.enabled;
  } catch (e) { $('stWifiNow').textContent = (e as Error).message; }
}

function paintNetworks(): void {
  if (wifiNow && !wifiNow.enabled) return;
  let nets: WifiNet[] = [];
  try { nets = device.wifiNetworks(); } catch (e) { $('stNets').innerHTML = `<div class="st-empty">${esc((e as Error).message)}</div>`; return; }
  nets = nets.filter(n => !n.current && n.ssid);
  if (!nets.length) {
    const blocked = setup?.items.some(i => (i.id === 'wifi' || i.id === 'location') && !i.done);
    $('stNets').innerHTML = `<div class="st-empty">${blocked ? 'The tablet hides network names until “Wi-Fi list allowed” is set up in Security.' : 'No other networks found yet.'}</div>`;
    return;
  }
  nets.sort((a, b) => Number(b.saved) - Number(a.saved) || b.bars - a.bars || a.ssid.localeCompare(b.ssid));
  $('stNets').innerHTML = nets.map(n => {
    const busy = n.ssid === joining, err = joinErrors.get(n.ssid);
    const sub = busy ? 'Joining…' : err ? err : n.enterprise ? 'Work network · not supported here' : n.saved ? 'Saved' : n.secure ? 'Secured' : 'Open';
    return `
    <button class="st-row st-net${busy ? ' busy' : ''}${n.enterprise ? ' dim' : ''}" data-join="${esc(n.ssid)}">
      ${wifiIcon(n.bars, n.secure)}
      <div class="st-txt"><b>${esc(n.ssid)}</b><span class="${err && !busy ? 'st-err' : ''}">${esc(sub)}</span></div>
      ${busy ? '<i class="st-spin"></i>' : `<span class="st-chev">${CHEV}</span>`}
    </button>`;
  }).join('');
}

let scanTimer: number | undefined;
function scan(): void {
  if (wifiNow && !wifiNow.enabled) return;
  try { device.wifiScan(); } catch { /* scans are throttled; results still come */ }
  $('stScanNote').innerHTML = '<i class="st-spin"></i>';
  $('stScan').hidden = true;
  clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => { paintNetworks(); $('stScanNote').textContent = ''; $('stScan').hidden = false; }, 3500);
}

function join(ssid: string, password = ''): void {
  joinErrors.delete(ssid);
  try {
    joining = ssid;
    const r = device.wifiConnect(ssid, password);
    if (r.panel) { joining = null; return; }   // Android's own Wi-Fi panel opened over ClaudeOS
    if (!r.ok) throw new Error('The tablet refused to join.');
    report('settings:wifi:join');
    // if it hasn't connected after a while, say so on the row
    setTimeout(() => {
      if (joining !== ssid) return;
      joining = null; joinErrors.set(ssid, 'Couldn’t join. Check the password and try again.');
      if (section === 'wifi') { paintWifi(); paintNetworks(); }
    }, 25e3);
  } catch (e) {
    joining = null;
    joinErrors.set(ssid, `Couldn’t join: ${(e as Error).message}`);
  }
  paintWifi(); paintNetworks();
}

function onJoin(ssid: string): void {
  const n = (() => { try { return device.wifiNetworks().find(x => x.ssid === ssid); } catch { return undefined; } })();
  if (!n || n.ssid === joining) return;
  if (n.enterprise) { confirmSheet('Work network', 'Networks that need a username aren’t supported in ClaudeOS yet. The device settings (in About) can join them.', 'OK', () => {}); return; }
  // a saved network that just failed to join was saved with the wrong password: ask for the password again, not reuse it
  if ((n.saved && !joinErrors.has(n.ssid)) || !n.secure || !setup?.owner) { join(n.ssid); return; }   // otherwise Android's panel asks for the password
  // a WPA passphrase is up to 63 characters; a secret is shown as dots
  Keyboard.open({ placeholder: `Password for ${n.ssid}`, done: 'Join', max: 63, mask: true, onDone: pw => { if (pw.length < 8) return false; join(n.ssid, pw); } });
}

// ---------- Bluetooth: read only ----------
function paintBluetooth(): void {
  let bt: BluetoothInfo | null = null;
  if (nativeHas('bluetooth')) { try { bt = device.bluetooth(); } catch { bt = null; } }
  gateRow(rowOf('stBtNote'), !!bt);
  const list = $('stBtList');
  if (!bt) { $('stBtState').textContent = '–'; $('stBtNote').textContent = '–'; list.innerHTML = ''; return; }
  if (!bt.supported) { $('stBtState').textContent = 'None'; $('stBtNote').textContent = 'This tablet has no Bluetooth.'; list.innerHTML = ''; return; }
  $('stBtState').textContent = bt.on ? 'On' : 'Off';
  $('stBtNote').textContent = bt.on ? 'Devices already paired with this tablet.' : 'Off. Switching it on isn’t possible from here yet.';
  list.innerHTML = bt.on
    ? (bt.devices.length
      ? bt.devices.map(d => `<div class="st-row"><div class="st-txt"><b>${esc(d.name)}</b><span class="num">${esc(d.mac)}</span></div><span class="st-done">Paired</span></div>`).join('')
      : '<div class="st-empty">No devices paired yet. Pairing a new one isn’t possible from here yet.</div>')
    : '';
}

// ---------- Display ----------
function paintSlider(id: string, v: number, text?: string): void {
  const el = $<HTMLInputElement>(id);
  el.value = String(Math.round(v * 100));
  el.style.setProperty('--p', `${(+el.value - +el.min) / (+el.max - +el.min) * 100}%`);
  $(`${id}V`).textContent = text ?? (+el.value === 0 ? 'Off' : `${el.value}%`);
}
function bindSlider(id: string, apply: (v: number) => void, text?: (v: number) => string): void {
  const el = $<HTMLInputElement>(id);
  el.addEventListener('input', () => {
    el.style.setProperty('--p', `${(+el.value - +el.min) / (+el.max - +el.min) * 100}%`);
    $(`${id}V`).textContent = text ? text(+el.value / 100) : +el.value === 0 ? 'Off' : `${el.value}%`;
    try { apply(+el.value / 100); } catch { /* ignore */ }
  });
}

let screenState: ScreenState | null = null;
function paintDisplay(): void {
  screenState = nativeHas('screen') ? device.screen() : null;
  if (screenState) autoBrightness.on = screenState.auto;
  const auto = !!screenState && autoBrightness.on;
  // the Android-side controls need a newer tablet app: disabled until it's there
  gateRow(rowOf('stAutoBright'), !!screenState && nativeHas('setAutoBrightness'));
  gateRow(rowOf('stScreenOff'), !!screenState && nativeHas('setScreenOff'));
  setSwitch('stAutoBright', auto);
  setSeg('screen-off', screenState ? String(screenState.offSec) : '');
  paintSlider('stBright', prefs.brightness);
  $<HTMLInputElement>('stBright').disabled = auto;
  $('stBrightNote').textContent = auto
    ? 'Auto-brightness is setting the brightness. Turn it off to set it here.'
    : 'Night and the ambient screen dim below this, then bring it back.';
  setSwitch('stNight', prefs.night);
  setSeg('ambient', String(prefs.ambientMin));
  setSwitch('stPhotoFrame', prefs.photoFrame);
}

// ---------- Appearance ----------
/** The drawer's tiles in their order, each with Up and Down (quick-order.ts; the drawer reads the saved order). */
function paintTileOrder(): void {
  const order = tileOrder();
  $('stTiles').innerHTML = order.map((id, i) => {
    const name = esc(TILE_NAMES[id] ?? id);
    return `<div class="st-row"><div class="st-txt"><b>${name}</b></div>`
      + `<button class="st-btn hit ghost small" data-move="${esc(id)}" data-step="-1" aria-label="Move ${name} up"${i === 0 ? ' disabled' : ''}>Up</button>`
      + `<button class="st-btn hit ghost small" data-move="${esc(id)}" data-step="1" aria-label="Move ${name} down"${i === order.length - 1 ? ' disabled' : ''}>Down</button></div>`;
  }).join('');
}

function paintAppearance(): void {
  paintTileOrder();
  setSeg('theme', themeMode());
  setSeg('textsize', prefs.textLarge ? 'large' : 'normal');
  setSeg('replywidth', prefs.replyWide ? 'wide' : 'normal');
  setSwitch('stMotion', prefs.reduceMotion);
  setSwitch('stContrast', prefs.contrast);
  setSwitch('stShowPct', prefs.battPct);
  setSeg('popups', prefs.popupsStay ? 'stay' : 'auto');
  setSeg('raildir', prefs.railDir);
  setSeg('railedge', prefs.railEdge);
  // only the two edges that match the direction show
  const edges = railEdgesFor(prefs.railDir);
  ctx.root.querySelectorAll<HTMLElement>('[data-seg="railedge"] button').forEach(b => { b.hidden = !edges.includes(b.dataset.v as RailEdge); });
}

// ---------- Sound ----------
function paintSound(): void {
  let notifOk = false;
  try {
    const v = device.volume();
    // the notification volume comes back only from newer tablet apps
    notifOk = typeof v.notification === 'number';
    paintSlider('stMedia', v.media); paintSlider('stAlarm', v.alarm); paintSlider('stNotif', v.notification ?? .7);
    $('stMediaNote').textContent = v.media ? 'Chimes, the critter, and Claude’s spoken replies.' : 'Off: no chimes, and you won’t hear Claude’s spoken replies.';
  } catch { /* ignore */ }
  gateRow(rowOf('stNotif'), notifOk);
  setSwitch('stChimes', prefs.chimes);
  setSwitch('stDnd', prefs.dnd);
}

// ---------- Battery ----------
function paintBattery(): void {
  let b: Battery;
  try { b = device.battery(); } catch { return; }
  const low = b.percent <= 20 && !b.charging;
  $('stBattGlyph').innerHTML = batteryGlyph(b);
  $('stBattPct').textContent = `${b.percent}%`;
  $('stBattState').textContent = b.full ? 'Fully charged' : b.charging ? 'Charging' : low ? 'Low. Plug in soon.' : 'On battery';
  $('stBattBar').style.width = `${b.percent}%`;
  const row = ctx.root.querySelector('.st-battrow')!;
  row.classList.toggle('low', low);
  row.classList.toggle('charging', b.charging);
  const t = $('stBattTemp');
  t.textContent = `${b.tempC.toFixed(1)} °C`;
  t.classList.toggle('hot', b.tempC >= 42);
  $('stBattHealth').textContent = b.health === 'good' ? 'Good' : b.health[0].toUpperCase() + b.health.slice(1);
  $('stBattPlug').textContent = b.plugged === 'ac' ? 'Wall charger' : b.plugged === 'usb' ? 'USB port' : b.plugged === 'wireless' ? 'Wireless' : b.plugged ? 'Dock' : 'Unplugged';
  setSwitch('stLowPower', prefs.lowPower);
  setSeg('lowat', String(prefs.lowAt));
}

// ---------- Keyboard: ClaudeOS Keyboard ----------
function paintKeyboard(): void {
  const st = device.keyboard.status();
  $('stKbDetail').textContent = !st ? 'Needs the newer tablet app.'
    : st.isDefault ? 'ClaudeOS Keyboard is the tablet’s keyboard. Other keyboards stay installed, just not the default.'
    : 'ClaudeOS Keyboard isn’t the default yet. Another keyboard is still the tablet’s keyboard.';
  const btn = $('stKbDefault');
  btn.hidden = !st || st.isDefault;
  btn.textContent = st && !st.canSet ? 'Open settings' : 'Make default';
  // the keyboard's own switches: needs the newer tablet app
  const kp = nativeHas('keyboardPrefs') ? device.keyboard.prefs() : null;
  gateRow(rowOf('stKbSuggest'), !!kp);
  gateRow(rowOf('stKbSounds'), !!kp);
  setSwitch('stKbSuggest', kp ? kp.suggestions : true);
  setSwitch('stKbSounds', kp ? kp.keySounds : false);
}

// ---------- Storage ----------
// ---------- Settings backup (Storage): save to the PC, restore on request (backup.ts) ----------
async function paintBackupNote(): Promise<void> {
  $('stBkNote').textContent = backupNote(await loadSettings());
}
function initBackup(): void {
  $('stBkSave').addEventListener('click', async () => {
    $('stBkMsg').textContent = 'Saving…';
    const r = await saveSettings();
    $('stBkMsg').textContent = r.ok ? `Saved ${r.count} settings to your PC.` : (r.error ?? 'Couldn’t save.');
    // A good save answers with its own time and count, so the note needs no second read.
    if (r.ok && r.saved) $('stBkNote').textContent = savedNote(r.saved, r.count ?? 0);
    else void paintBackupNote();
  });
  $('stBkRestore').addEventListener('click', () => {
    confirmSheet('Restore settings from your PC?', 'The settings on this tablet are replaced with the ones saved on your PC. The page then reloads.', 'Restore', async () => {
      const n = await restoreSettings();
      const outcome = restoreOutcome(n);
      $('stBkMsg').textContent = outcome.msg;
      if (outcome.note !== null) $('stBkNote').textContent = outcome.note;
      if (n > 0) location.reload();
    });
  });
}

async function paintStorage(): Promise<void> {
  let st: StorageInfo | null = null;
  if (nativeHas('storage')) { try { st = device.storage(); } catch { st = null; } }
  gateRow(rowOf('stStUsed'), !!st);
  if (st) {
    const used = st.total - st.free;
    $('stStUsed').textContent = `${bytes(used)} used`;
    $('stStNote').textContent = `${bytes(st.free)} free of ${bytes(st.total)}. The apps and ClaudeOS share it.`;
    ($('stStBar') as HTMLElement).style.width = `${st.total ? used / st.total * 100 : 0}%`;
  } else {
    $('stStUsed').textContent = '–';
    $('stStNote').textContent = '–';
  }
  try {
    const p = await getJson<{ photos: number }>('/api/settings/storage');
    $('stStPhotos').textContent = bytes(p.photos);
  } catch { $('stStPhotos').textContent = '–'; }
  // the files the Browser saved: "1.2 GB, 14 files"
  const dl = nativeHas('browserDownloadsSize') ? device.browserDownloads() : null;
  gateRow(rowOf('stStDownloads'), !!dl);
  $('stStDownloads').textContent = !dl ? '–'
    : dl.count ? `${bytes(dl.bytes)}, ${dl.count} file${dl.count === 1 ? '' : 's'}` : 'None yet';
}

// ---------- Date & time ----------
/** Time zones a person is likely to want, listed as IANA names (the tablet checks each one). */
const ZONES = ['Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam',
  'Europe/Athens', 'Europe/Helsinki', 'Europe/Moscow', 'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'Asia/Dubai', 'Asia/Karachi',
  'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Perth', 'Australia/Sydney',
  'Pacific/Auckland', 'America/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver', 'America/Chicago',
  'America/New_York', 'America/Halifax', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'UTC'];
const zoneLabel = (id: string): string => (id === 'UTC' ? 'UTC' : id.split('/').pop()!.replace(/_/g, ' '));

function paintDateTime(): void {
  let z = null;
  if (nativeHas('timeZone', 'setTimeZone')) { try { z = device.timeZone(); } catch { z = null; } }
  gateRow(rowOf('stTz'), !!z);
  if (!z) {
    $('stTzV').textContent = '–';
    $('stTzNote').textContent = '–';
  } else {
    $('stTzV').textContent = zoneLabel(z.id);
    $('stTzNote').textContent = z.auto ? `${z.id}, set automatically from the network. Choose one here to set it yourself.` : z.id;
  }
  const h = store.get('os.clock24');
  const hc = (new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions() as { hourCycle?: string }).hourCycle;
  const is24 = h == null ? hc === 'h23' || hc === 'h24' : h === '1';
  setSwitch('stH24', is24);
  $('stH24Note').textContent = `Shows ${clock(new Date(2000, 0, 1, 14, 5))} as ${is24 ? 'the 24-hour time' : 'the 12-hour time'}.`;
}

function pickZone(): void {
  let cur = '';
  try { cur = device.timeZone()?.id ?? ''; } catch { /* ignore */ }
  const ids = cur && !ZONES.includes(cur) ? [cur, ...ZONES] : ZONES;
  openChooser('Time zone', 'Times, alarms and timers use this zone.', ids.map(id => ({ id, label: zoneLabel(id), sub: id })), cur, id => {
    try { device.setTimeZone(id); report('settings:time:zone'); }
    catch (e) { confirmSheet('Couldn’t change it', (e as Error).message || 'The tablet wouldn’t change the time zone.', 'OK', () => {}); }
    paintDateTime();
  });
}

// ---------- Battery: low power ----------
// (the switch and the "turn on by itself" choice are on Battery; the effects are in core/web/system.ts)

// ---------- Privacy & data: Claude history on the tablet, and the city for the weather ----------
/** What the tablet keeps about Claude sessions: only the sidebar's folded groups (sessions themselves live on the PC). */
const CLAUDE_HISTORY_KEYS = ['claude.sb.fold', 'claude.sb.folded'];

function paintPrivacy(): void {
  const has = CLAUDE_HISTORY_KEYS.some(k => store.get(k) != null);
  $('stClaudeHistClear').hidden = !has;
  $('stClaudeHistNote').textContent = has
    ? 'Forgets which sidebar groups are folded on this tablet. Your sessions on the PC are kept.'
    : 'Nothing saved on this tablet. Your sessions on the PC are kept.';
}

function clearClaudeHistory(): void {
  confirmSheet('Clear Claude history?', 'Forgets what this tablet has saved of your sessions. Your sessions on the PC are kept.', 'Clear', () => {
    CLAUDE_HISTORY_KEYS.forEach(k => store.set(k, null));
    report('settings:privacy:claude-history');
    paintPrivacy();
  });
}

// the weather-city reads and save give up on a PC that does not answer; a read that is no longer the newest does not repaint
const WX_TIMEOUT_MS = 20e3;
let wxSeq = 0;
async function paintWeatherPlace(): Promise<void> {
  const seq = ++wxSeq;
  try {
    const w = await getJson<Weather>('/api/weather/forecast', WX_TIMEOUT_MS);
    if (seq !== wxSeq) return;   // a newer read, or a saved city, came first
    const note = $('stWxNote');
    if (w.status === 'ok' && w.place) note.innerHTML = `The weather is for ${esc(w.place)}.`;
    else if (w.status === 'no_location') note.textContent = 'Not set yet. Choose a city.';
    else if (w.status === 'not_found') note.innerHTML = `City not found: ${esc(w.city)}. Choose a city.`;
    else if (w.status === 'error') note.textContent = 'The weather service didn’t answer, so the city can’t be checked.';
    else note.textContent = 'Where the weather is for.';
  } catch { if (seq !== wxSeq) return; $('stWxNote').textContent = 'Couldn’t reach your PC to check.'; }
}

function editWeatherCity(): void {
  Keyboard.open({ placeholder: 'A city, like Lisbon', done: 'Save', autoCap: true, max: 60, onDone: t => { void findWeatherCity(t.trim()); } });
}

async function findWeatherCity(q: string): Promise<void> {
  if (q.length < 2) return;
  let r: PlacesResponse;
  try {
    r = await getJson<PlacesResponse>(`/api/weather/places?q=${encodeURIComponent(q)}`, WX_TIMEOUT_MS);
  } catch { confirmSheet('Couldn’t look that up', 'Check the connection to your PC, then try again.', 'OK', () => {}); return; }
  if (r.status !== 'ok') { confirmSheet('Couldn’t look that up', 'The city search service didn’t answer. Try again in a moment.', 'OK', () => {}); return; }
  const res = r.results;
  if (!res.length) { confirmSheet('No place found', `Nothing matches “${q}”. Try the city’s country too.`, 'OK', () => {}); return; }
  openChooser('Weather for', 'Pick the place the weather is for.',
    res.map((p, i) => ({ id: String(i), label: p.name, sub: [p.region, p.country].filter(Boolean).join(', ') })), '',
    id => { void saveWeatherPlace(res[+id]); });
}

async function saveWeatherPlace(p: Place): Promise<void> {
  try {
    const w = await postJson<Weather>('/api/weather/location', { lat: p.lat, lon: p.lon, place: p.name }, WX_TIMEOUT_MS);
    wxSeq++;   // a forecast read still out is for the old city: it must not put that city back
    report('settings:privacy:weather');
    if (w.status === 'error' && w.saved === false) { confirmSheet('Couldn’t save', w.error ?? 'The PC couldn’t save the place.', 'OK', () => {}); void paintWeatherPlace(); return; }
    // The city is saved. A forecast that did not load still names it, and the repaint is skipped so this text stays.
    if (w.status !== 'ok') { $('stWxNote').innerHTML = `The weather is for ${esc(p.name)}.`; return; }
  } catch { confirmSheet('Couldn’t save', 'Check the connection to your PC, then try again.', 'OK', () => {}); }
  void paintWeatherPlace();
}

// ---------- Wellbeing ----------
let quietDraft: QuietHours = prefs.quiet;
function daysText(days: number[]): string {
  if (days.length === 7) return 'every day';
  if (days.length === 5 && [1, 2, 3, 4, 5].every(d => days.includes(d))) return 'weekdays';
  if (!days.length) return 'no days';
  return days.map(d => DAYS[d].slice(0, 3)).join(', ');
}
const hm12 = (s: string): string => clock(new Date(2000, 0, 1, +s.split(':')[0], +s.split(':')[1]));

function paintWellbeing(): void {
  setSeg('break', String(prefs.breakMin));
  setSeg('breakway', prefs.breakWay);
  rowOf('stBreakWayRow').hidden = !prefs.breakMin;
  const q = prefs.quiet;
  setSwitch('stQuiet', q.on);
  $('stQuietNote').textContent = q.on
    ? `${hm12(q.from)} to ${hm12(q.to)}, ${daysText(q.days)}.${quietNow() ? ' On now.' : ''}`
    : 'Off. Chimes and spoken alerts keep to their usual times.';
}

function paintQuietSheet(): void {
  setSeg('qfrom', quietDraft.from);
  setSeg('qto', quietDraft.to);
  $('stQDays').innerHTML = SHORT_DAYS.map((d, i) => `<button class="hit${quietDraft.days.includes(i) ? ' on' : ''}" data-day="${i}" aria-label="${DAYS[i]}">${d}</button>`).join('');
  setSwitch('stQWake', quietDraft.pauseWake);
}

// ---------- Security: Desk mode ----------
/** Shown on a Desk mode step the device owner has not managed to apply yet (ClaudeOS tries again on its own). */
const OWNER_RETRY = 'ClaudeOS couldn’t set this up yet. It tries again each time it comes to the front.';

function paintSetup(): void {
  setup = device.setup();
  const pill = $('stKiosk');
  if (!setup) { $('stKioskText').textContent = 'Desk mode'; return; }
  const required = setup.items.filter(i => !i.optional);
  const left = required.filter(i => !i.done).length;
  pill.classList.toggle('ok', setup.owner || (!left && setup.kiosk));
  pill.classList.toggle('todo', !setup.owner && left > 0);
  $('stKioskText').textContent = setup.owner ? 'Desk mode · locked' : left ? `Finish setup · ${left} left` : setup.kiosk ? 'Desk mode on' : 'Desk mode paused';
  $('stKioskLeft').textContent = left ? String(left) : '';
  $('stRebootRow').hidden = !setup.owner;   // only a device owner may restart the tablet
  setSwitch('stGuardOn', setup.kiosk);
  if (section !== 'security') return;

  const allDone = !left;
  $('stAllSet').hidden = !allDone;
  $('stAllSetIc').innerHTML = TICK;
  $('stAllSetText').textContent = setup.owner
    ? 'ClaudeOS is this tablet’s home screen, and it’s locked to it.'
    : `ClaudeOS is this tablet’s home screen. All ${required.length} setup steps are done.`;
  $('stShowSteps').textContent = stepsOpen ? 'Hide steps' : 'Show steps';
  const optionalLeft = setup.items.filter(i => i.optional && !i.done);
  // once everything's done the checklist folds away; optional extras stay offered
  const visible = allDone && !stepsOpen ? optionalLeft : [...setup.items].sort((a, b) => Number(a.done) - Number(b.done) || Number(a.optional) - Number(b.optional));
  $('stSetup').hidden = !visible.length;
  $('stSetupHead').textContent = allDone && !stepsOpen ? 'Optional' : 'One-time setup';
  $('stSetupCount').textContent = allDone && !stepsOpen ? '' : `${required.length - left} of ${required.length} done`;
  $('stSetupBar').hidden = allDone;
  ($('stSetupBar').firstElementChild as HTMLElement).style.width = `${(required.length - left) / Math.max(1, required.length) * 100}%`;
  // As device owner ClaudeOS applies every step itself: a step shows Done, or a ClaudeOS error (with a retry that
  // re-applies it silently). Without device owner the steps are finished by hand, through the buttons below.
  $('stSteps').innerHTML = visible.map(i => `
    <div class="st-row st-step${i.done ? ' done' : ''}">
      <span class="st-check">${i.done ? TICK : ''}</span>
      <div class="st-txt"><b>${esc(i.title)}${i.optional && (!allDone || stepsOpen) ? '<span class="st-tag">Optional</span>' : ''}</b>
        <span>${esc(i.detail.replace(/^Optional:\s*/, '').replace(/^\w/, c => c.toUpperCase()))}${i.id === 'guard' && !i.done && !setup?.owner ? ' If its switch is greyed out, open App info first, then ⋮ → Allow restricted settings.' : ''}</span></div>
      ${i.done ? '<span class="st-done">Done</span>'
        : setup?.owner ? `<div class="st-rowbtns"><span class="st-err">${esc(OWNER_RETRY)}</span></div>`
        : `<div class="st-rowbtns">${
        i.id === 'guard' ? '<button class="st-btn hit ghost" data-fix="restricted">App info</button>' : ''}<button class="st-btn hit" data-fix="${esc(i.id)}">Set up</button></div>`}
    </div>`).join('');
}

// ---------- System monitor: the hub's uptime, the PC link, the open apps (Close) and the apps that did not start (Restart) ----------
async function paintMonitor(): Promise<void> {
  let uptime: number | null = null;
  try { uptime = (await getJson<{ uptimeSeconds: number }>('/api/core/status')).uptimeSeconds; } catch { uptime = null; }
  const open = openedApps();
  const failed = failedApps();
  const l = monitorLines({ uptimeSeconds: uptime, openNames: open.map(a => a.name), failedNames: failed.map(a => a.name) });
  $('stMonUptime').textContent = l.uptime;
  $('stMonPc').textContent = l.pc;
  $('stMonOpen').innerHTML = open.length
    ? open.map(a => `<div class="st-row"><div class="st-txt"><b>${esc(a.name)}</b></div>${a.closable
      ? `<button class="st-btn hit ghost small" data-close="${esc(a.key)}">Close</button>` : ''}</div>`).join('')
    : '<div class="st-empty">No apps are open.</div>';
  $('stMonFailedText').textContent = l.failed;
  $('stMonFailed').innerHTML = failed.map(a => `<div class="st-row"><div class="st-txt"><b>${esc(a.name)}</b><span>Couldn’t start</span></div>`
    + `<button class="st-btn hit ghost small" data-restart="${esc(a.id)}">Restart</button></div>`).join('');
}

// ---------- Software update (About): this build, the PC's build, and Update now after a confirm (update.ts) ----------
let pcBuild: number | null = null;   // the PC's build as last read (the confirm names it)

function lastUpdateText(): string | null {
  try {
    const l = JSON.parse(store.get('os.lastUpdate') || 'null') as { at?: number; text?: string } | null;
    return l?.text ? `${l.text} · ${new Date(l.at ?? 0).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : null;
  } catch { return null; }
}

async function paintUpdate(): Promise<void> {
  let avail: UpdateAvailable | null = null;
  if (onTablet) { try { avail = device.updateAvailable() as UpdateAvailable; } catch { avail = null; } }
  try { pcBuild = (await getJson<{ versionCode: number }>('/apk/version')).versionCode; } catch { pcBuild = null; }
  const s = updateStatus(avail, pcBuild);
  $('stUpdInstalled').textContent = avail?.installed != null ? `Build ${avail.installed}` : '–';
  $('stUpdPc').textContent = pcBuild != null ? `Build ${pcBuild}` : '–';
  $('stUpdStatus').textContent = onTablet ? s.text : 'Updates are for the tablet app.';
  $('stUpdNow').hidden = !s.canUpdate;
  $('stUpdLast').textContent = lastUpdateText() ?? 'Nothing yet';
}

function initUpdate(): void {
  $('stUpdNow').addEventListener('click', () => {
    confirmSheet('Update ClaudeOS?', `This tablet installs build ${pcBuild ?? 'from your PC'}. ClaudeOS restarts when the update is done.`, 'Update', () => {
      let r: UpdateStart;
      try { r = device.updateCheck() as UpdateStart; } catch (e) { r = { status: 'error', error: (e as Error).message }; }
      store.set('os.lastUpdate', JSON.stringify({ at: Date.now(), text: resultText(r) }));
      void paintUpdate();
    });
  });
}

// ---------- About ----------
function paintAbout(): void {
  try {
    const i = device.info();
    $('stVersion').textContent = `Version ${i.app} · Desk tablet`;
    $('stModel').textContent = `${i.maker} ${i.model}`;
  } catch { /* ignore */ }
  $('stScreen').textContent = `${Math.round(screen.width * devicePixelRatio)} × ${Math.round(screen.height * devicePixelRatio)}`;
  $('stConn').textContent = !navigator.onLine ? 'Offline' : hubReachable() ? `Connected to ${location.host}` : 'Wi-Fi is on, but the PC can’t be reached';
  $('stServer').textContent = `Your PC · ${location.host}`;
  // the Hub's own status: how long it has run (a page that can't reach it keeps the address line alone)
  getJson<{ uptimeSeconds: number }>('/api/core/status').then(s => {
    $('stServer').textContent = `Your PC · ${location.host} · running ${uptimeText(s.uptimeSeconds)}`;
  }).catch(() => { /* not reachable now: keep the address line */ });
  try {
    const w = device.wifi();
    $('stNet').textContent = w.ssid || (w.enabled ? 'Not connected' : 'Wi-Fi off');
    $('stIp').textContent = w.ip || '–';
  } catch { /* ignore */ }
  $('stDeskV').textContent = !setup ? '–' : setup.owner ? 'Locked' : setup.kiosk ? 'On' : 'Paused';
}

// ---------- Developer: wireless debugging (ADB over Wi-Fi) ----------
function paintDeveloper(retry = 0): void {
  let st: AdbWifiState | null = null;
  if (nativeHas('adbWifi', 'setAdbWifi', 'setAdbWifiKeep')) { try { st = device.adbWifi(); } catch { st = null; } }
  gateRow(rowOf('stAdbOn'), !!st);
  gateRow(rowOf('stAdbKeep'), !!st);
  if (!st) {
    $('stAdbDetail').textContent = '–';
    setSwitch('stAdbOn', false); setSwitch('stAdbKeep', false);
    $('stAdbSetupRow').hidden = true;
    return;
  }
  setSwitch('stAdbOn', st.on);
  setSwitch('stAdbKeep', st.keep);
  $('stAdbSetupRow').hidden = !st.needsGrant;
  $('stAdbDetail').textContent = st.needsGrant ? 'Needs a one-time setup from the PC'
    : !st.on ? 'Off'
    : st.ip ? `On · ${st.port ? `${st.ip}:${st.port}` : `${st.ip}, port shown on the PC`}`
    : 'On · connect to Wi-Fi to see the address';
  // the port comes from the network a moment after the switch is on: look again for a few seconds
  if (st.on && st.ip && !st.port && retry < 6) setTimeout(() => paintDeveloper(retry + 1), 1500);
}

function mount(context: AppContext): void {
  ctx = context;
  bindApps();
  initPlugins({ ctx, confirm: confirmSheet });
  initPinSettings(ctx);
  addEventListener('hub:app-settings', e => openAppSettings((e as CustomEvent<string>).detail));
  ctx.root.querySelectorAll<HTMLElement>('#stGroups .ic').forEach(el => { el.innerHTML = NAV_ICONS[el.dataset.icon!] || ''; });
  if (!voice.available) {
    $('stNavVoice').hidden = true;
    ctx.root.querySelector<HTMLElement>('.st-sec[data-sec="voice"]')!.remove();
  }
  // the iPad (web): the tablet-only sections are hidden. Their code still runs as before, so only the nav and the sections' display change.
  for (const s of TABLET_ONLY) {
    if (!deviceOnlyHidden(s)) continue;
    ctx.root.querySelector<HTMLElement>(`#stGroups button[data-sec="${s}"]`)!.hidden = true;
    ctx.root.querySelector<HTMLElement>(`.st-sec[data-sec="${s}"]`)!.hidden = true;
  }
  buildIndex();

  // the nav, and the search above it
  $('stGroups').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-sec]');
    if (b) { report(`settings:${b.dataset.sec}`); show(b.dataset.sec!); }
  });
  $('stSearch').addEventListener('click', () => {
    Keyboard.open({
      value: $('stSearchText').classList.contains('st-unset') ? '' : $('stSearchText').textContent || '',
      placeholder: 'Search settings', done: 'Search', autoCap: false, max: 40,
      onChange: t => search(t),
      onDone: t => { search(t); },
    });
  });
  $('stHits').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-hit]');
    if (b) { report('settings:search'); jumpTo(hits[+b.dataset.hit!]); }
  });
  $('stKiosk').addEventListener('click', () => show('security'));

  // every "[data-seg] button": one delegated handler (the sheets' segments too)
  ctx.root.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-seg] button[data-v]');
    if (b) handleSeg(b.parentElement!.dataset.seg!, b.dataset.v!);
  });

  // Profile
  $('stFieldName').addEventListener('click', () => editName('name'));
  $('stFieldNick').addEventListener('click', () => editName('nickname'));
  $('stFieldRole').addEventListener('click', () => { paintRoles(); $('stRolePick').hidden = false; });
  $('stRoleList').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-role]');
    if (!b) return;
    $('stRolePick').hidden = true;
    void saveProfile({ role: b.dataset.role ?? '' });
  });
  $('stRoleDone').addEventListener('click', () => { $('stRolePick').hidden = true; });
  $('stRolePick').addEventListener('click', e => { if (e.target === $('stRolePick')) $('stRolePick').hidden = true; });
  $('stAvatar').addEventListener('click', () => void openPhotoSheet());
  $('stPhotoPick').addEventListener('click', () => void openPhotoSheet());
  $('stPhotoRemove').addEventListener('click', () => confirmSheet('Remove your photo?',
    'The photo is deleted from the PC. Your initials show instead, until you pick another.', 'Remove', () => void removePhoto()));
  $('stGoogleAdd').addEventListener('click', () => confirmSheet('Add a Google account?',
    'Google’s own sign-in screen opens next, and it covers ClaudeOS until you finish. Sign in, then come back to this page.', 'Continue', () => openGoogleSignIn()));
  $('stGoogleCheck').addEventListener('click', () => checkGoogleAccess());
  $('stPhotoGrid').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-photo]');
    if (b) void usePhoto(b.dataset.photo!);
  });
  $('stPhotoCancel').addEventListener('click', () => { photoSheetSeq++; $('stPhotoSheet').hidden = true; });
  $('stPhotoSheet').addEventListener('click', e => { if (e.target === $('stPhotoSheet')) { photoSheetSeq++; $('stPhotoSheet').hidden = true; } });
  onProfile(() => { if (section === 'profile') paintProfile(); });

  // Your Claude
  $('stInstr').addEventListener('click', editInstructions);

  // Sessions
  $('stNewModel').addEventListener('click', pickModel);
  $('stNewMode').addEventListener('click', pickMode);
  $('stNewFolder').addEventListener('click', pickFolder);
  $('stChooseList').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-choose]');
    if (!b) return;
    $('stChoose').hidden = true;
    chooseHandler?.(b.dataset.choose ?? '');
  });
  $('stChooseDone').addEventListener('click', () => { $('stChoose').hidden = true; });
  $('stChoose').addEventListener('click', e => { if (e.target === $('stChoose')) $('stChoose').hidden = true; });

  // Notifications
  $('stBanners').addEventListener('click', () => { prefs.banners = !prefs.banners; paintAlerts(); });
  $('stNotesClear').addEventListener('click', clearNotifications);
  swipeNotices($('stNotes'));
  $('stNotes').addEventListener('click', e => {
    const mute = (e.target as HTMLElement).closest<HTMLElement>('[data-mute]')?.dataset.mute;
    if (mute !== undefined) { toggleMuteApp(mute); return; }
    const app = (e.target as HTMLElement).closest<HTMLElement>('[data-app]')?.dataset.app;
    if (app && app !== 'settings') openApp(app);
  });
  initBackup();
  initUpdate();
  $('stTiles').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-move]');
    if (!b?.dataset.move) return;
    setTileOrder(moveTile(tileOrder(), b.dataset.move, +(b.dataset.step ?? 1) === -1 ? -1 : 1));
    paintTileOrder();
  });
  $('stMuted').addEventListener('click', e => {
    const mute = (e.target as HTMLElement).closest<HTMLElement>('[data-mute]')?.dataset.mute;
    if (mute !== undefined) toggleMuteApp(mute);
  });
  onNotificationsChange(() => { if (section === 'notifications') paintNotes(); });
  // System monitor: Close an open app, or Restart one that did not start
  $('stMonOpen').addEventListener('click', e => {
    const key = (e.target as HTMLElement).closest<HTMLElement>('[data-close]')?.dataset.close;
    if (key) { closeApp(key); void paintMonitor(); }
  });
  $('stMonFailed').addEventListener('click', e => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-restart]')?.dataset.restart;
    if (id) { restartApp(id); void paintMonitor(); }
  });
  // a toggle made on the drawer (Do Not Disturb, low power, Wi-Fi, "Hey Claude", Desk mode) repaints the open section
  onSystemChange(() => { if (ctx.isVisible()) paint(); });

  // Network (Wi-Fi)
  const forget = (ssid: string) => confirmSheet(`Forget ${ssid}?`, 'The tablet disconnects and stops joining it. If it’s the only Wi-Fi here, ClaudeOS goes offline until you join another network.',
    'Forget', () => {
      let ok = false;
      try { ok = device.wifiForget(ssid).ok; } catch { ok = false; }
      paintWifi(); paintNetworks();
      if (!ok) $('stWifiNow').textContent = 'Couldn’t forget ' + ssid + '. Try again.';
    });
  $('stWifiCurrent').addEventListener('click', e => {
    const f = (e.target as HTMLElement).closest<HTMLElement>('[data-forget]');
    if (f) forget(f.dataset.forget!);
  });
  $('stNets').addEventListener('click', e => {
    const j = (e.target as HTMLElement).closest<HTMLElement>('[data-join]');
    if (j) onJoin(j.dataset.join!);
  });
  $('stScan').addEventListener('click', scan);
  $('stWifiOn').addEventListener('click', () => {
    const on = $('stWifiOn').getAttribute('aria-checked') !== 'true';
    const apply = () => {
      setSwitch('stWifiOn', on);
      try { device.wifiEnable(on); } catch { /* ignore */ }
      setTimeout(() => { paintWifi(); if (on) scan(); }, 800);
    };
    if (on) apply();
    else confirmSheet('Turn off Wi-Fi?', 'ClaudeOS gets everything from your PC over Wi-Fi, so it stops updating until you turn Wi-Fi back on here.', 'Turn off', apply);
  });

  // Display
  bindSlider('stBright', v => { prefs.brightness = Math.max(.02, v); });   // night and ambient dim below this, then restore it
  $('stAutoBright').addEventListener('click', () => {
    const on = !autoBrightness.on;
    try { device.setAutoBrightness(on); autoBrightness.on = on; report(`settings:display:auto:${on}`); }
    catch (e) { confirmSheet('Couldn’t change it', (e as Error).message, 'OK', () => {}); }
    prefs.brightness = prefs.brightness;   // puts ClaudeOS's own brightness back, or leaves it to Android
    paintDisplay();
  });
  $('stNight').addEventListener('click', () => { prefs.night = !prefs.night; paintDisplay(); });
  $('stPhotoFrame').addEventListener('click', () => { prefs.photoFrame = !prefs.photoFrame; report(`settings:photo-frame:${prefs.photoFrame}`); paintDisplay(); });
  $('stRestNow').addEventListener('click', () => { report('settings:ambient:now'); sleep(); });

  // Appearance
  $('stMotion').addEventListener('click', () => { prefs.reduceMotion = !prefs.reduceMotion; paintAppearance(); });
  $('stContrast').addEventListener('click', () => { prefs.contrast = !prefs.contrast; paintAppearance(); });
  $('stShowPct').addEventListener('click', () => { prefs.battPct = !prefs.battPct; paintAppearance(); });

  // Sound
  bindSlider('stMedia', v => {
    device.setVolume('media', v);
    $('stMediaNote').textContent = v ? 'Chimes, the critter, and Claude’s spoken replies.' : 'Off: no chimes, and you won’t hear Claude’s spoken replies.';
  });
  bindSlider('stAlarm', v => device.setVolume('alarm', v));
  bindSlider('stNotif', v => device.setVolume('notification', v));
  $('stChimes').addEventListener('click', () => {
    prefs.chimes = !prefs.chimes; paintSound();
    if (prefs.chimes) chime(0);   // a sample of what the chime sounds like
  });
  $('stDnd').addEventListener('click', () => { prefs.dnd = !prefs.dnd; report(`settings:sound:dnd:${prefs.dnd}`); paintSound(); });

  // Voice
  if (voice.available) {
    $('stWake').addEventListener('click', () => {
      const on = $('stWake').getAttribute('aria-checked') !== 'true';
      setSwitch('stWake', on);
      report(`settings:voice:wake:${on}`);
      try { voice.setWake(on); } catch (e) { confirmSheet('Couldn’t change it', (e as Error).message, 'OK', () => {}); }
      voiceUi.refresh();   // the system-wide voice indicator shows or hides its idle spark at once
      setTimeout(() => { paintVoice(); voiceUi.refresh(); }, 600);   // if Android is asking for the microphone, onResume re-reads it afterwards
    });
    $('stVoicePick').addEventListener('click', () => { paintPicker(); $('stPick').hidden = false; });
    $('stVoiceLang').addEventListener('click', pickLanguage);
    $('stPickDone').addEventListener('click', () => { $('stPick').hidden = true; });
    $('stPick').addEventListener('click', e => { if (e.target === $('stPick')) $('stPick').hidden = true; });
    $('stPickList').addEventListener('click', e => {
      if ((e.target as HTMLElement).closest('[data-all]')) { pickAll = true; paintPicker(); return; }
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-voice]');
      if (!b) return;
      const id = b.dataset.voice!;
      try { voice.setVoice(id); } catch (err) { confirmSheet('Couldn’t change the voice', (err as Error).message, 'OK', () => {}); }
      report('settings:voice:pick');
      // and let you hear it straight away
      if (mediaVolume() === 0) { try { device.setVolume('media', .5); } catch { /* ignore */ } }
      try { voice.preview(id, VOICE_SAMPLE); previewing = id; } catch { previewing = null; }
      paintPicker(); paintVoice();
    });
    voice.on(e => { if (e.type === 'spoken' && e.id.startsWith('preview') && previewing !== null) { previewing = null; if (!$('stPick').hidden) paintPicker(); } });
    $('stCloudStt').addEventListener('click', () => {
      const on = $('stCloudStt').getAttribute('aria-checked') !== 'true';
      setSwitch('stCloudStt', on);
      report(`settings:voice:cloudstt:${on}`);
      try { voice.setCloudStt(on); } catch (err) { setSwitch('stCloudStt', !on); confirmSheet('Couldn’t change it', (err as Error).message, 'OK', () => {}); }
      paintSttFn();
    });
    $('stSttDl').addEventListener('click', () => {
      report('settings:voice:sttdownload');
      try { voice.downloadStt(); } catch (err) { confirmSheet('Couldn’t start the download', (err as Error).message, 'OK', () => {}); }
      setTimeout(paintSttFn, 1500);
    });
    $('stNatural').addEventListener('click', () => {
      const on = $('stNatural').getAttribute('aria-checked') !== 'true';
      setSwitch('stNatural', on);
      report(`settings:voice:natural:${on}`);
      try { voice.setNatural(on); } catch (err) { setSwitch('stNatural', !on); confirmSheet('Couldn’t change it', (err as Error).message, 'OK', () => {}); }
      paintVoice();
    });
    $('stCritterSpeak').addEventListener('click', () => {
      prefs.critterSpeaks = !prefs.critterSpeaks;
      report(`settings:voice:critter:${prefs.critterSpeaks}`);
      paintVoice();
    });
    bindSlider('stRate', v => { voice.setVoice(null, v); }, v => rateText(v));
    $('stTest').addEventListener('click', () => {
      report('settings:voice:test');
      if (mediaVolume() === 0) { try { device.setVolume('media', .5); } catch { /* ignore */ } }
      try { voice.speak(SAMPLE, 'settings-sample'); } catch (e) { confirmSheet('Couldn’t play it', (e as Error).message, 'OK', () => {}); }
      paintVoice();
    });
  }

  // Battery: low power
  $('stLowPower').addEventListener('click', () => { prefs.lowPower = !prefs.lowPower; report(`settings:battery:lowpower:${prefs.lowPower}`); paintBattery(); });

  // Keyboard
  $('stKbDefault').addEventListener('click', () => {
    const st = device.keyboard.status();
    if (st && !st.canSet) { device.fix('keyboard'); return; }   // Android's keyboard list, where it can be picked by hand
    try { device.keyboard.makeDefault(); } catch (e) { confirmSheet('Couldn’t change it', (e as Error).message, 'OK', () => {}); }
    paintKeyboard();
  });
  const kbSwitch = (id: string, name: 'suggestions' | 'keySounds') => $(id).addEventListener('click', () => {
    const on = $(id).getAttribute('aria-checked') !== 'true';
    setSwitch(id, on);
    report(`settings:keyboard:${name}:${on}`);
    try { device.keyboard.setPref(name, on); } catch (e) { setSwitch(id, !on); confirmSheet('Couldn’t change it', (e as Error).message, 'OK', () => {}); }
  });
  kbSwitch('stKbSuggest', 'suggestions');
  kbSwitch('stKbSounds', 'keySounds');
  $('stKbClear').addEventListener('click', () => confirmSheet('Clear learned words?',
    'Forgets the words ClaudeOS Keyboard learned while you typed. Its word list stays.', 'Clear',
    () => { try { device.keyboard.clearLearned(); } catch { /* older app: nothing learned to clear */ } }));

  // Date & time
  $('stTz').addEventListener('click', pickZone);
  $('stH24').addEventListener('click', () => {
    const on = $('stH24').getAttribute('aria-checked') !== 'true';
    store.set('os.clock24', on ? '1' : '0');
    report(`settings:time:24h:${on}`);
    paintDateTime();
  });

  // Privacy & data: links to the apps that keep the things
  $('stOpenPhotos').addEventListener('click', () => { report('settings:privacy:photos'); openApp('photos'); });
  $('stOpenBrowser').addEventListener('click', () => { report('settings:privacy:browser'); openApp('browser'); });
  $('stClaudeHistClear').addEventListener('click', clearClaudeHistory);
  $('stWxSet').addEventListener('click', editWeatherCity);

  // Wellbeing
  $('stQuiet').addEventListener('click', () => {
    const q = { ...prefs.quiet, on: !prefs.quiet.on };
    prefs.quiet = q;
    report(`settings:wellbeing:quiet:${q.on}`);
    paintWellbeing();
  });
  $('stQuietSet').addEventListener('click', () => { quietDraft = { ...prefs.quiet }; paintQuietSheet(); $('stQuietSheet').hidden = false; });
  $('stQDays').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-day]');
    if (!b) return;
    const d = +b.dataset.day!;
    quietDraft = { ...quietDraft, days: toggleQuietDay(quietDraft.days, d) };
    paintQuietSheet();
  });
  $('stQWake').addEventListener('click', () => { quietDraft = { ...quietDraft, pauseWake: !quietDraft.pauseWake }; setSwitch('stQWake', quietDraft.pauseWake); });
  $('stQDone').addEventListener('click', () => { prefs.quiet = { ...quietDraft, on: true }; $('stQuietSheet').hidden = true; report('settings:wellbeing:quiet:set'); paintWellbeing(); });
  $('stQuietSheet').addEventListener('click', e => { if (e.target === $('stQuietSheet')) $('stQuietSheet').hidden = true; });

  // Security: Desk mode
  $('stSteps').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-fix]');
    if (!b) return;
    report(`settings:setup:${b.dataset.fix}`);
    try { device.fix(b.dataset.fix!); } catch { /* ignore */ }
  });
  $('stShowSteps').addEventListener('click', () => { stepsOpen = !stepsOpen; paintSetup(); });
  $('stGuardOn').addEventListener('click', () => {
    const on = $('stGuardOn').getAttribute('aria-checked') !== 'true';
    try { device.setKiosk(on); } catch { /* ignore */ }
    paintSetup();
  });

  // Developer: wireless debugging
  $('stAdbOn').addEventListener('click', () => {
    const on = $('stAdbOn').getAttribute('aria-checked') !== 'true';
    report(`settings:developer:adb:${on}`);
    try {
      const r = device.setAdbWifi(on);
      if (!r.ok && r.needsGrant) confirmSheet('One-time setup needed', 'Connect the tablet to the PC once with a cable, and run one setup command there. After that this switch works on its own.', 'OK', () => {});
    } catch (e) { confirmSheet('Couldn’t change it', (e as Error).message, 'OK', () => {}); }
    paintDeveloper();
  });
  $('stAdbKeep').addEventListener('click', () => {
    const on = $('stAdbKeep').getAttribute('aria-checked') !== 'true';
    report(`settings:developer:keep:${on}`);
    try { device.setAdbWifiKeep(on); } catch { /* older app: nothing to keep */ }
    paintDeveloper();
  });

  // About
  $('stReload').addEventListener('click', () => { report('settings:reload'); location.reload(); });
  $('stAndroid').addEventListener('click', () => confirmSheet('Open Android settings?',
    'Desk mode pauses while you’re there. Press Home or Back to come back to ClaudeOS.', 'Open', () => { report('settings:android'); device.maintenance(); }));
  $('stReboot').addEventListener('click', () => confirmSheet('Restart the tablet?', 'It takes about a minute and comes straight back to ClaudeOS.', 'Restart',
    () => { report('settings:reboot'); device.reboot(); }));

  $('stWelcome').addEventListener('click', () => { report('settings:welcome'); showWelcome(true); });

  // the control center, the rail's battery and banners open a section directly
  addEventListener('hub:settings', e => { const s = (e as CustomEvent<string | null>).detail; if (s) show(s); });
  onResume(() => { if (ctx.isVisible()) paint(); if (voice.available) voiceUi.refresh(); });

  // Back (system.ts): the sheet on top closes first, through its own Cancel or Done where it has one (so its state is
  // reset the same way); then, in Apps, an app's page goes back to the Apps list; then Home. The quiet-hours sheet has
  // no Back button that saves, so Back just closes it, without saving.
  const SHEET_BACK: Record<string, string> = {
    stPin: 'stPinCancel', stPlugSheet: 'stPlugClose', stPlugAdd: 'stPlugAddCancel', stPhotoSheet: 'stPhotoCancel',
    stChoose: 'stChooseDone', stRolePick: 'stRoleDone', stPick: 'stPickDone',
  };
  onBack(() => {
    if (!ctx.isVisible()) return false;
    const top = [...ctx.root.querySelectorAll<HTMLElement>('.st-sheet:not([hidden])')].pop();
    if (top) {
      const cancel = SHEET_BACK[top.id];
      if (cancel) $(cancel).click(); else top.hidden = true;
      return true;
    }
    if (appOpen && section === 'apps') { appOpen = null; paintApps(); paintTabApps(); return true; }
    return false;
  }, 10);
  show(section);
}

/** A segmented control was tapped: what its choice does. */
function handleSeg(id: string, v: string): void {
  switch (id) {
    case 'alert-done': case 'alert-approval': case 'alert-timer': case 'alert-event': {
      const kind = id === 'alert-done' ? 'done' : id === 'alert-approval' ? 'approval' : id === 'alert-event' ? 'event' : 'timer';
      prefs.setAlert(kind, v as 'chime' | 'critter' | 'banner' | 'off');
      report(`settings:alert:${kind}:${v}`);
      paintAlerts();
      return;
    }
    case 'voicestyle': {
      try { voice.setPitch(+v); report(`settings:voice:style:${v}`); }
      catch (e) { confirmSheet('Couldn’t change it', (e as Error).message, 'OK', () => {}); }
      paintVoice();
      return;
    }
    case 'screen-off': {
      const sec = +v;
      try { device.setScreenOff(sec); report(`settings:display:off:${sec}`); }
      catch (e) { confirmSheet('Couldn’t change it', (e as Error).message, 'OK', () => {}); }
      paintDisplay();
      return;
    }
    case 'ambient': prefs.ambientMin = +v; report(`settings:ambient:${v}`); paintDisplay(); return;
    case 'theme': setThemeMode(v as ThemeMode); report(`settings:theme:${v}`); paintAppearance(); return;
    case 'textsize': prefs.textLarge = v === 'large'; paintAppearance(); return;
    case 'replywidth': prefs.replyWide = v === 'wide'; paintAppearance(); return;
    case 'popups': prefs.popupsStay = v === 'stay'; paintAppearance(); return;
    case 'raildir': prefs.railDir = v as RailDir; report(`settings:rail:dir:${v}`); paintAppearance(); return;
    case 'railedge': prefs.railEdge = v as RailEdge; report(`settings:rail:edge:${v}`); paintAppearance(); return;
    case 'break': prefs.breakMin = +v; report(`settings:wellbeing:break:${v}`); paintWellbeing(); return;
    case 'breakway': prefs.breakWay = v as 'banner' | 'critter'; paintWellbeing(); return;
    case 'lowat': prefs.lowAt = +v; report(`settings:battery:lowat:${v}`); paintBattery(); return;
    case 'qfrom': quietDraft = { ...quietDraft, from: v }; setSeg('qfrom', v); return;
    case 'qto': quietDraft = { ...quietDraft, to: v }; setSeg('qto', v); return;
    default: handlePluginSeg(id, v); return;
  }
}

const app: HubApp = {
  ...manifest,
  icon: ICON,
  mount,
  onShow() {
    paint();
    syncHeard();
    void refreshProfile();   // the profile may have changed on another screen
    if (section === 'wifi') scan();
    if (section === 'plugins') void loadPlugins();
    if (section === 'yourclaude') void loadInstructions();
    if (section === 'usage') void loadUsage();
    timers = [window.setInterval(() => { if (section === 'wifi') { paintWifi(); paintNetworks(); } }, 4000),
              window.setInterval(() => {
                if (section === 'battery') paintBattery();
                if (section === 'voice') paintVoice();
                if (section === 'display') paintDisplay();
                if (section === 'about') paintAbout();
                if (section === 'developer') paintDeveloper();
              }, 10e3),
              window.setInterval(() => { if (section === 'usage') void loadUsage(); }, 60e3)];
  },
  onHide() { timers.forEach(clearInterval); timers = []; clearInterval(heardT); heardT = undefined; },
};
export default app;
