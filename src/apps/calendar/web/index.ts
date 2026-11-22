// The Calendar app: today's and tomorrow's events, side by side, read-only.
//
// The PC reads the calendar (an ICS "secret address", set here or in Settings > Apps > Calendar, typed on ClaudeOS's
// own keyboard) and sends the events (GET /api/calendar/events). The address is never shown back: only its host.
// The events reload when the app comes on screen and every 5 minutes while it is there; Refresh reads the calendar now.
import { esc, getJson, postJson } from '../../../core/web/dom.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { appSettingsChanged, registerAppSettings, type SettingRow } from '../../../core/web/app-settings.ts';
import { eventTime, type CalConfigResult, type CalEvent, type CalEvents, type CalStatus } from '../api.ts';
import { manifest } from '../manifest.ts';

const API = `/api/${manifest.id}`;
const REFRESH_MS = 5 * 60e3;

export const CALENDAR_ICON = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">'
  + '<rect x="5.5" y="7.5" width="21" height="19" rx="3"/><path d="M5.5 13.5h21M11 5v5M21 5v5"/><path d="M10.5 18h3M18.5 18h3M10.5 22h3"/></svg>';

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);

let status: CalStatus | null = null;
let data: CalEvents | null = null;
let failed = false;
let busy = false;
let msg = '';
let timer: number | undefined;

const hmFmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat([], { weekday: 'long', day: 'numeric', month: 'long' });

// Removing the calendar forgets its secret address on the PC, so it asks twice (like clearing history does).
let removeArmed = false;
let removeTimer = 0;

function disarmRemove(): void {
  clearTimeout(removeTimer);
  if (!removeArmed) return;
  removeArmed = false;
  appSettingsChanged();
}

function armRemove(): void {
  removeArmed = true;
  clearTimeout(removeTimer);
  removeTimer = window.setTimeout(disarmRemove, 20000);
  appSettingsChanged();
}

// ---------- talking to the PC ----------
async function loadStatus(): Promise<void> {
  try { status = await getJson<CalStatus>(`${API}/status`); } catch { /* keep what we had */ }
  appSettingsChanged();
}

async function load(force = false): Promise<void> {
  if (busy) return;
  busy = true;
  render();
  try { data = await getJson<CalEvents>(`${API}/events${force ? '?refresh=1' : ''}`); failed = false; }
  catch { failed = true; }
  busy = false;
  render();
  appSettingsChanged();
}

async function saveAddress(address: string): Promise<void> {
  let r: CalConfigResult | null = null;
  try { r = await postJson<CalConfigResult>(`${API}/config`, { address }); } catch { /* below */ }
  if (r) { status = { configured: r.configured, address: r.address }; msg = r.ok ? '' : r.message ?? 'That didn’t work.'; }
  else msg = 'Couldn’t reach the PC. Try again in a moment.';
  appSettingsChanged();
  await load(true);
  // tell the Home screen's Today tile
  dispatchEvent(new CustomEvent('hub:calendar'));
}

function editAddress(): void {
  Keyboard.open({ value: '', placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics', done: 'Save', max: 2000,
    onDone: v => { if (v.trim()) void saveAddress(v); } });
}

// ---------- drawing ----------
function rowHtml(e: CalEvent, now: number): string {
  const s = Date.parse(e.start), en = Date.parse(e.end);
  const past = en <= now && !(en === s && s > now - 60e3);
  const on = !e.allDay && s <= now && en > now;
  const t = new Date(now), dayStart = new Date(t.getFullYear(), t.getMonth(), t.getDate() + (e.day === 'today' ? 0 : 1)).getTime();
  const started = !e.allDay && s < dayStart;   // began the day before: "Until 10:00 AM"
  const time = e.allDay ? 'All day' : started ? 'Until' : eventTime(e, hmFmt);
  const sub = !e.allDay && en > s ? (started ? hmFmt.format(new Date(en)) : `to ${hmFmt.format(new Date(en))}`) : '';
  return `<li class="cal-ev${past ? ' past' : ''}${on ? ' now' : ''}"><span class="cal-time">${esc(time)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>`
    + `<span><div class="cal-title">${esc(e.title)}</div>${e.location ? `<div class="cal-where">${esc(e.location)}</div>` : ''}</span></li>`;
}

function render(): void {
  if (!ctx) return;
  const d = data;
  const notSet = (d?.status === 'not_set') || (status != null && !status.configured && !d);
  $('calSetup').hidden = !notSet;
  $('calDays').hidden = notSet;
  ($('calRefresh') as HTMLButtonElement).disabled = busy;
  $('calRefresh').hidden = notSet;
  $('calRefresh').textContent = busy ? 'Reading…' : 'Refresh';

  const note = msg || (failed ? 'Couldn’t reach the PC. Trying again…'
    : d?.status === 'error' ? d.error ?? 'Couldn’t read the calendar.'
    : d?.stale ? `Couldn’t read the calendar just now, so this is from ${hmFmt.format(new Date(d.fetchedAt ?? Date.now()))}. ${d.error ?? ''}` : '');
  $('calNote').hidden = !note;
  $('calNote').textContent = note;

  const now = new Date();
  $('calTodayDate').textContent = dateFmt.format(now);
  $('calTmrDate').textContent = dateFmt.format(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  if (notSet) return;
  const list = (day: 'today' | 'tomorrow') => {
    const evs = (d?.events ?? []).filter(e => e.day === day);
    if (!d) return `<li class="cal-none">${busy ? 'Reading the calendar…' : ''}</li>`;
    if (d.status === 'error') return '<li class="cal-none">Can’t show the calendar right now</li>';
    return evs.length ? evs.map(e => rowHtml(e, now.getTime())).join('') : '<li class="cal-none">Nothing on the calendar</li>';
  };
  $('calToday').innerHTML = list('today');
  $('calTmr').innerHTML = list('tomorrow');
}

// ---------- settings (Settings > Apps > Calendar) ----------
function settingRows(): SettingRow[] {
  const s = status, d = data;
  const rows: SettingRow[] = [
    { kind: 'action', id: 'address', title: 'Calendar address',
      detail: msg || 'Your calendar’s secret address in iCal format (it ends in .ics). Kept only on the PC; ClaudeOS only reads the calendar.',
      value: () => (s?.configured ? s.address : 'Not set'), label: s?.configured ? 'Replace' : 'Add', run: editAddress },
  ];
  if (s?.configured) {
    rows.push({ kind: 'info', id: 'state', title: 'Status',
      detail: d?.status === 'error' ? d.error : d?.stale ? d.error : undefined,
      value: () => (!d ? 'Not read yet' : d.status === 'error' ? 'Couldn’t read' : d.stale ? 'Out of date'
        : `${d.events.filter(e => e.day === 'today').length} today, ${d.events.filter(e => e.day === 'tomorrow').length} tomorrow`) });
    if (!removeArmed) {
      rows.push({ kind: 'action', id: 'remove', title: 'Remove the calendar', detail: 'Forgets the address on the PC. You’d need to paste it again.', label: 'Remove', run: armRemove });
    } else {
      rows.push({ kind: 'action', id: 'remove', title: 'Remove the calendar?', detail: 'The address is forgotten on the PC. This can’t be undone.', label: 'Remove',
        run: () => { disarmRemove(); void saveAddress(''); } });
      rows.push({ kind: 'action', id: 'removeKeep', title: 'Keep the calendar', label: 'Keep', run: disarmRemove });
    }
  }
  return rows;
}

// ---------- the app ----------
function start(): void { stop(); timer = window.setInterval(() => { void load(); }, REFRESH_MS); }
function stop(): void { if (timer) clearInterval(timer); timer = undefined; }

const app: HubApp = {
  ...manifest,
  icon: CALENDAR_ICON,
  mount(c) {
    ctx = c;
    $('calRefresh').addEventListener('click', () => { void load(true); });
    $('calSetupGo').addEventListener('click', editAddress);
    registerAppSettings({ app: manifest.id, name: manifest.name, icon: CALENDAR_ICON, blurb: 'The calendar address (read-only)', rows: settingRows });
    void loadStatus();
    render();
  },
  onShow() { msg = ''; void loadStatus(); void load(); start(); },
  onHide() { stop(); },
};
export default app;
