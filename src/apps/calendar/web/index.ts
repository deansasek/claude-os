// The Calendar app: Day, Week, Month and Year, read-only.
//
// The PC reads the calendar and sends the events for the range on screen (GET /api/calendar/range). The calendar is an
// ICS "secret address" set here or in Settings > Apps > Calendar, typed on ClaudeOS's own keyboard. With no address, the
// claude.ai calendar connector answers for today and tomorrow (GET /api/calendar/connector). Each connector read is a
// Claude turn, so it happens only when the app opens, when Refresh is tapped, or when the view moves to another day.
// The 5-minute timer never makes a connector read.
import { esc, getJson, postJson } from '../../../core/web/dom.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { appSettingsChanged, registerAppSettings, type SettingRow } from '../../../core/web/app-settings.ts';
import type { CalConfigResult, CalStatus } from '../api.ts';
import { manifest } from '../manifest.ts';

const API = `/api/${manifest.id}`;
const REFRESH_MS = 5 * 60e3;

export const CALENDAR_ICON = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">'
  + '<rect x="5.5" y="7.5" width="21" height="19" rx="3"/><path d="M5.5 13.5h21M11 5v5M21 5v5"/><path d="M10.5 18h3M18.5 18h3M10.5 22h3"/></svg>';

type View = 'day' | 'week' | 'month' | 'year';
/** One event in ms, as the PC sends it. */
interface Ev { title: string; start: number; end: number; allDay: boolean; location?: string }
interface RangeAnswer { status: 'ok' | 'not_set' | 'error'; events?: Ev[]; error?: string; stale?: boolean }
interface ConnAnswer { status?: string; events?: Ev[]; error?: string }

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);

let status: CalStatus | null = null;
let view: View = 'day';
let anchor = startOfDay(new Date());
let events: Ev[] = [];
let viaConnector = false;   // the events are the connector's (today and tomorrow only)
let loading = false;
let failed = false;
let msg = '';               // a note that replaces the default one
let timer: number | undefined;

// Removing the calendar forgets its secret address on the PC, so it asks twice.
let removeArmed = false;
let removeTimer = 0;

// ---------- dates ----------
const pad = (n: number): string => String(n).padStart(2, '0');
const keyOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function startOfDay(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function fromKey(k: string): Date { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
const sameDay = (a: Date, b: Date): boolean => keyOf(a) === keyOf(b);
const timeFmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat([], { weekday: 'long', day: 'numeric', month: 'long' });
const monthFmt = new Intl.DateTimeFormat([], { month: 'long', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat([], { weekday: 'short' });
const weekdayLong = new Intl.DateTimeFormat([], { weekday: 'narrow' });

/** The first day a view shows: the day itself, its Sunday, the Sunday before the 1st, or the year's 1st. */
function firstShown(): Date {
  if (view === 'day') return anchor;
  if (view === 'week') return addDays(anchor, -anchor.getDay());
  if (view === 'month') { const f = new Date(anchor.getFullYear(), anchor.getMonth(), 1); return addDays(f, -f.getDay()); }
  return new Date(anchor.getFullYear(), 0, 1);
}

/** The days [from, to) to read for the view on screen. */
function rangeFor(): { from: Date; to: Date } {
  const f = firstShown();
  if (view === 'day') return { from: anchor, to: addDays(anchor, 1) };
  if (view === 'week') return { from: f, to: addDays(f, 7) };
  if (view === 'month') return { from: f, to: addDays(f, 42) };
  return { from: f, to: new Date(anchor.getFullYear() + 1, 0, 1) };
}

/** Events that fall on a day, all-day first, then by start time. */
function eventsOn(day: Date): Ev[] {
  const a = startOfDay(day).getTime(), b = addDays(day, 1).getTime();
  return events
    .filter(e => e.start < b && (e.end > a || (e.end === e.start && e.start >= a)))
    .sort((x, y) => (x.allDay === y.allDay ? 0 : x.allDay ? -1 : 1) || x.start - y.start);
}

/** The days (YYYY-MM-DD) that have at least one event, for the Year view's dots. */
function daysWithEvents(): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    let d = startOfDay(new Date(e.start));
    for (let i = 0; i < 400 && d.getTime() < Math.max(e.end, e.start + 1); i++) { out.add(keyOf(d)); d = addDays(d, 1); }
  }
  return out;
}

// ---------- talking to the PC ----------
async function loadStatus(): Promise<void> {
  try { status = await getJson<CalStatus>(`${API}/status`); } catch { /* keep what we had */ }
  appSettingsChanged();
}

/** The events for the view on screen. auto: the 5-minute timer, which never makes a connector read. */
async function load(force = false, auto = false): Promise<void> {
  if (loading) return;
  if (auto && viaConnector) return;
  loading = true;
  failed = false;
  render();
  try {
    const { from, to } = rangeFor();
    const r = await getJson<RangeAnswer>(`${API}/range?from=${keyOf(from)}&to=${keyOf(to)}${force ? '&refresh=1' : ''}`);
    if (r.status === 'ok') {
      events = r.events ?? [];
      viaConnector = false;
      msg = r.stale ? `Couldn’t read the calendar just now, so this may be out of date. ${r.error ?? ''}`.trim() : '';
    } else if (r.status === 'error') {
      events = [];
      viaConnector = false;
      msg = r.error ?? 'Couldn’t read the calendar.';
    } else {
      await loadConnector();
    }
  } catch {
    failed = true;
    events = [];
    viaConnector = false;
    msg = 'Couldn’t reach the PC. Trying again…';
  }
  loading = false;
  render();
  appSettingsChanged();
}

/** No address: the connector answers for today and tomorrow only. */
async function loadConnector(): Promise<void> {
  const today = startOfDay(new Date()), tomorrow = addDays(today, 1);
  const day = sameDay(anchor, today) ? 'today' : sameDay(anchor, tomorrow) ? 'tomorrow' : null;
  if (view !== 'day' || !day) {
    events = [];
    viaConnector = false;
    msg = view === 'day'
      ? 'The claude.ai calendar reads today and tomorrow. Add a calendar address in Settings for other days.'
      : 'Week, month and year need a calendar address (Settings > Apps > Calendar).';
    return;
  }
  const r = await getJson<ConnAnswer>(`${API}/connector?day=${day}`);
  if (r.status !== 'ok' || !r.events) {
    events = [];
    viaConnector = false;
    msg = r.error ?? 'Couldn’t read the claude.ai calendar connector.';
    return;
  }
  events = r.events;
  viaConnector = true;
  msg = '';
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

// ---------- moving around ----------
function setView(v: View): void {
  view = v;
  void load();
  render();
}

function setDay(d: Date): void {
  anchor = startOfDay(d);
  view = 'day';
  void load();
  render();
}

function step(dir: 1 | -1): void {
  if (view === 'day') anchor = addDays(anchor, dir);
  else if (view === 'week') anchor = addDays(anchor, 7 * dir);
  else if (view === 'month') anchor = new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  else anchor = new Date(anchor.getFullYear() + dir, 0, 1);
  void load();
  render();
}

function goToday(): void {
  anchor = startOfDay(new Date());
  void load();
  render();
}

// ---------- drawing ----------
function evRow(e: Ev, day: Date): string {
  const now = Date.now(), isToday = sameDay(day, new Date());
  const past = isToday && !e.allDay && e.end <= now;
  const on = isToday && !e.allDay && e.start <= now && e.end > now;
  const time = e.allDay ? 'All day' : timeFmt.format(new Date(e.start));
  const sub = !e.allDay && e.end > e.start ? `to ${timeFmt.format(new Date(e.end))}` : '';
  return `<li class="cal-ev${past ? ' past' : ''}${on ? ' now' : ''}"><span class="cal-time">${esc(time)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>`
    + `<span><div class="cal-title-ev">${esc(e.title)}</div>${e.location ? `<div class="cal-where">${esc(e.location)}</div>` : ''}</span></li>`;
}

function dayHtml(): string {
  const list = eventsOn(anchor);
  if (!list.length) return `<p class="cal-none">${loading ? 'Reading the calendar…' : 'Nothing on this day'}</p>`;
  return `<ul class="cal-list">${list.map(e => evRow(e, anchor)).join('')}</ul>`;
}

function weekHtml(): string {
  const first = firstShown(), cols: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(first, i), list = eventsOn(d);
    const body = list.length
      ? list.map(e => `<div class="cal-chip${e.allDay ? ' all' : ''}"><small>${e.allDay ? 'All day' : esc(timeFmt.format(new Date(e.start)))}</small>${esc(e.title)}</div>`).join('')
      : '<p class="cal-none">Nothing</p>';
    cols.push(`<div class="cal-wcol"><button class="cal-wh${sameDay(d, new Date()) ? ' today' : ''}" data-day="${keyOf(d)}">`
      + `<small>${esc(weekdayFmt.format(d))}</small><b>${d.getDate()}</b></button>${body}</div>`);
  }
  return `<div class="cal-week">${cols.join('')}</div>`;
}

function monthHtml(): string {
  const first = firstShown(), month = anchor.getMonth(), cells: string[] = [];
  for (let i = 0; i < 7; i++) cells.push(`<div class="cal-mh">${esc(weekdayLong.format(addDays(first, i)))}</div>`);
  for (let i = 0; i < 42; i++) {
    const d = addDays(first, i), list = eventsOn(d), out = d.getMonth() !== month;
    const pills = list.slice(0, 2).map(e => `<span class="cal-pill">${esc(e.title)}</span>`).join('');
    const more = list.length > 2 ? `<span class="cal-more">+${list.length - 2} more</span>` : '';
    cells.push(`<button class="cal-cell${out ? ' out' : ''}" data-day="${keyOf(d)}"><b${sameDay(d, new Date()) ? ' class="today"' : ''}>${d.getDate()}</b>${pills}${more}</button>`);
  }
  return `<div class="cal-month">${cells.join('')}</div>`;
}

function yearHtml(): string {
  const y = anchor.getFullYear(), has = daysWithEvents(), today = keyOf(new Date()), months: string[] = [];
  for (let m = 0; m < 12; m++) {
    const f = new Date(y, m, 1), start = addDays(f, -f.getDay());
    const cells: string[] = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(l => `<span>${l}</span>`);
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i), k = keyOf(d);
      if (d.getMonth() !== m) { cells.push('<span class="cal-dd blank"></span>'); continue; }
      cells.push(`<button class="cal-dd${has.has(k) ? ' has' : ''}${k === today ? ' today' : ''}" data-day="${k}">${d.getDate()}</button>`);
    }
    months.push(`<section class="cal-mini"><h3 data-month="${y}-${pad(m + 1)}">${esc(new Intl.DateTimeFormat([], { month: 'long' }).format(f))}</h3>`
      + `<div class="cal-mgrid">${cells.join('')}</div></section>`);
  }
  return `<div class="cal-year">${months.join('')}</div>`;
}

function titleText(): string {
  if (view === 'day') return dayFmt.format(anchor);
  if (view === 'week') { const f = firstShown(); return `${shortFmt.format(f)} – ${shortFmt.format(addDays(f, 6))}`; }
  if (view === 'month') return monthFmt.format(anchor);
  return String(anchor.getFullYear());
}

function render(): void {
  if (!ctx) return;
  for (const v of ['day', 'week', 'month', 'year'] as View[]) {
    const b = $(`calV-${v}`);
    b.classList.toggle('on', view === v);
    b.setAttribute('aria-selected', String(view === v));
  }
  $('calTitle').textContent = titleText();
  ($('calRefresh') as HTMLButtonElement).disabled = loading;
  $('calRefresh').textContent = loading ? 'Reading…' : 'Refresh';
  const note = msg || (failed ? 'Couldn’t reach the PC. Trying again…' : viaConnector ? 'From your claude.ai calendar connector.' : '');
  $('calNote').hidden = !note;
  $('calNote').textContent = note;
  const body = view === 'day' ? dayHtml() : view === 'week' ? weekHtml() : view === 'month' ? monthHtml() : yearHtml();
  $('calBody').innerHTML = loading && !events.length ? '<p class="cal-none">Reading the calendar…</p>' : body;
}

// ---------- settings (Settings > Apps > Calendar) ----------
function settingRows(): SettingRow[] {
  const s = status;
  const rows: SettingRow[] = [
    { kind: 'action', id: 'address', title: 'Calendar address',
      detail: msg || 'Your calendar’s secret address in iCal format (it ends in .ics). Kept only on the PC; ClaudeOS only reads the calendar.',
      value: () => (s?.configured ? s.address : 'Not set'), label: s?.configured ? 'Replace' : 'Add', run: editAddress },
  ];
  if (!s?.configured) {
    rows.push({ kind: 'info', id: 'source', title: 'Without an address', detail: 'The claude.ai calendar reads today and tomorrow when you open the app.',
      value: () => 'claude.ai connector' });
  }
  if (s?.configured) {
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

// ---------- the app ----------
function start(): void { stop(); timer = window.setInterval(() => { void load(false, true); }, REFRESH_MS); }
function stop(): void { if (timer) clearInterval(timer); timer = undefined; }

const app: HubApp = {
  ...manifest,
  icon: CALENDAR_ICON,
  mount(c) {
    ctx = c;
    $('calRefresh').addEventListener('click', () => { void load(true); });
    $('calPrev').addEventListener('click', () => step(-1));
    $('calNext').addEventListener('click', () => step(1));
    $('calToday').addEventListener('click', goToday);
    for (const v of ['day', 'week', 'month', 'year'] as View[]) $(`calV-${v}`).addEventListener('click', () => setView(v));
    // a day, a week's header, a month cell, or a month name in the Year view
    $('calBody').addEventListener('click', e => {
      const t = e.target as HTMLElement;
      const day = t.closest<HTMLElement>('[data-day]');
      if (day?.dataset.day) { setDay(fromKey(day.dataset.day)); return; }
      const month = t.closest<HTMLElement>('[data-month]');
      if (month?.dataset.month) {
        const [y, m] = month.dataset.month.split('-').map(Number);
        anchor = new Date(y, m - 1, 1);
        view = 'month';
        void load();
        render();
      }
    });
    registerAppSettings({ app: manifest.id, name: manifest.name, icon: CALENDAR_ICON, blurb: 'The calendar address (read-only)', rows: settingRows });
    void loadStatus();
    render();
  },
  onShow() { msg = ''; void loadStatus(); void load(); start(); },
  onHide() { stop(); },
};
export default app;
