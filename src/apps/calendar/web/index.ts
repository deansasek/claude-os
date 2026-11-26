// The Calendar app: Day, Week, Month and Year, read-only.
//
// The PC reads the calendar and sends the events for the range on screen (GET /api/calendar/range). The calendar is an
// ICS "secret address" set here or in Settings > Apps > Calendar, typed on ClaudeOS's own keyboard. With no address, the
// claude.ai calendar connector answers for today and tomorrow (GET /api/calendar/connector). Each connector read is a
// Claude turn, so it happens only when the app opens, when Refresh is tapped, or when the view moves to another day.
// The 5-minute timer never makes a connector read.
import { esc, getJson, postJson, store } from '../../../core/web/dom.ts';
import { caps } from '../../../core/web/device.ts';
import { alertFor, onBack } from '../../../core/web/system.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { appSettingsChanged, registerAppSettings, type SettingRow } from '../../../core/web/app-settings.ts';
import type { CalConfigResult, CalEvent, CalEvents, CalStatus } from '../api.ts';
import { copyUsable, dueNotices, eventKey, noticeText, parseCopy, pcAnswer, pruneNotified, type EventCopy, type Notified } from './event-notice.ts';
import { manifest } from '../manifest.ts';
import { monthWeeks, shiftEnd, stepClock } from './pickers.ts';
import { flagsOf, tagCalendar, visibleEvents, type CalendarInfo } from './calendars.ts';
import { editable, formCanShow, ownEvent } from './edit.ts';

const API = `/api/${manifest.id}`;
const REFRESH_MS = 5 * 60e3;

export const CALENDAR_ICON = appIcon('calendar');

type View = 'day' | 'week' | 'month' | 'year';
/** One event in ms, as the PC sends it. */
interface Ev { id?: string; title: string; start: number; end: number; allDay: boolean; location?: string; calendar?: string }
interface RangeAnswer { status: 'ok' | 'not_set' | 'error'; events?: Ev[]; error?: string; stale?: boolean }
interface ConnAnswer { status?: string; events?: Ev[]; error?: string }

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);

let status: CalStatus | null = null;
let statusFailed = false;   // the last status read threw: the PC could not be reached, so the address is unknown
let view: View = 'day';
let anchor = startOfDay(new Date());
let events: Ev[] = [];
let calendars: CalendarInfo[] = [];   // the calendars and their shown flags, from the PC (the chips)
let viaConnector = false;   // the events are the connector's (today and tomorrow only)
let loading = false;
let failed = false;
let msg = '';               // a note that replaces the default one
let timer: number | undefined;

// Removing the calendar forgets its secret address on the PC, so it asks twice.
let removeArmed = false;
let removeTimer = 0;

// The event open in its details sheet (a ClaudeOS event), and whether its Delete has been tapped once.
let detailId: string | null = null;
let deleteArmed = false;
let detailErr = '';

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

/** The events of the calendars that are shown. A hidden calendar's events are not drawn. */
function drawn(): Ev[] { return visibleEvents(events, flagsOf(calendars)); }

/** Events that fall on a day, all-day first, then by start time. */
function eventsOn(day: Date): Ev[] {
  const a = startOfDay(day).getTime(), b = addDays(day, 1).getTime();
  return drawn()
    .filter(e => e.start < b && (e.end > a || (e.end === e.start && e.start >= a)))
    .sort((x, y) => (x.allDay === y.allDay ? 0 : x.allDay ? -1 : 1) || x.start - y.start);
}

/** The days (YYYY-MM-DD) that have at least one event, for the Year view's dots. */
function daysWithEvents(): Set<string> {
  const out = new Set<string>();
  for (const e of drawn()) {
    let d = startOfDay(new Date(e.start));
    for (let i = 0; i < 400 && d.getTime() < Math.max(e.end, e.start + 1); i++) { out.add(keyOf(d)); d = addDays(d, 1); }
  }
  return out;
}

// ---------- talking to the PC ----------
async function loadStatus(): Promise<void> {
  try { status = await getJson<CalStatus>(`${API}/status`); statusFailed = false; } catch { statusFailed = true; /* keep what we had */ }
  await loadCalendars();
  appSettingsChanged();
}

const RANGE_TIMEOUT_MS = 20_000;   // the PC's own calendar read gives up after 10 s (server/calendar.ts)
/** The events for the view on screen. auto: the 5-minute timer. It sends auto=1, and it never makes a connector read. */
async function load(force = false, auto = false): Promise<void> {
  if (loading) return;
  if (auto && viaConnector) return;
  loading = true;
  failed = false;
  render();
  try {
    const { from, to } = rangeFor();
    const r = await getJson<RangeAnswer>(`${API}/range?from=${keyOf(from)}&to=${keyOf(to)}${force ? '&refresh=1' : ''}${auto ? '&auto=1' : ''}`, RANGE_TIMEOUT_MS);
    if (r.status === 'ok') {
      events = r.events ?? [];
      viaConnector = false;
      msg = r.stale ? `Couldn’t read the calendar just now, so this may be out of date. ${r.error ?? ''}`.trim() : '';
    } else if (r.status === 'error') {
      events = [];
      viaConnector = false;
      msg = r.error ?? 'Couldn’t read the calendar.';
    } else if (!auto) {
      await loadConnector();   // a user request only; the timer keeps the events it has
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

/** The calendars and their shown flags from the PC. A failed read keeps the chips as they were. */
async function loadCalendars(): Promise<void> {
  try {
    const r = await getJson<{ status?: string; calendars?: CalendarInfo[] }>(`${API}/calendars`);
    if (r.status === 'ok' && r.calendars) { calendars = r.calendars; render(); }
  } catch { /* keep what we had */ }
}

/** Shows or hides one calendar. The chip changes at once; the PC stores the flag, and a failed save puts it back. */
async function toggleCal(id: string): Promise<void> {
  const c = calendars.find(x => x.id === id);
  if (!c) return;
  const next = !c.shown;
  c.shown = next;
  render();
  let r: { status?: string; error?: string; calendars?: CalendarInfo[] } | null = null;
  try { r = await postJson<{ status?: string; error?: string; calendars?: CalendarInfo[] }>(`${API}/calendar-shown`, { id, shown: next }); } catch { r = null; }
  if (r?.status === 'ok' && r.calendars) calendars = r.calendars;
  else { c.shown = !next; msg = r?.error ?? 'Couldn’t reach the PC. Try again in a moment.'; }
  render();
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
  events = tagCalendar(r.events, 'connector');
  viaConnector = true;
  msg = '';
}

async function saveAddress(address: string): Promise<void> {
  let r: CalConfigResult | null = null;
  try { r = await postJson<CalConfigResult>(`${API}/config`, { address }); } catch { /* below */ }
  if (r) { status = { configured: r.configured, address: r.address }; statusFailed = false; msg = r.ok ? '' : r.message ?? 'That didn’t work.'; }
  else msg = 'Couldn’t reach the PC. Try again in a moment.';
  appSettingsChanged();
  await loadCalendars();
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
/** The attribute that opens an event's details: only a ClaudeOS event has one. External events are not tappable. */
const evData = (e: Ev): string => (ownEvent(e) ? ` data-ev="${esc(e.id ?? '')}"` : '');

function evRow(e: Ev, day: Date): string {
  const now = Date.now(), isToday = sameDay(day, new Date());
  const past = isToday && !e.allDay && e.end <= now;
  const on = isToday && !e.allDay && e.start <= now && e.end > now;
  const time = e.allDay ? 'All day' : timeFmt.format(new Date(e.start));
  const sub = !e.allDay && e.end > e.start ? `to ${timeFmt.format(new Date(e.end))}` : '';
  return `<li class="cal-ev${past ? ' past' : ''}${on ? ' now' : ''}"${evData(e)}><span class="cal-time">${esc(time)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>`
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
      ? list.map(e => `<div class="cal-chip${e.allDay ? ' all' : ''}"${evData(e)}><small>${e.allDay ? 'All day' : esc(timeFmt.format(new Date(e.start)))}</small>${esc(e.title)}</div>`).join('')
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
    const pills = list.slice(0, 2).map(e => `<span class="cal-pill"${evData(e)}>${esc(e.title)}</span>`).join('');
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
  $('calCals').hidden = !calendars.length;
  $('calCals').innerHTML = calendars.map(c => `<button class="cal-cal hit${c.shown ? ' on' : ''}" data-cal="${c.id}" aria-pressed="${c.shown}" style="--c:${c.colour}"><i></i>${esc(c.name)}</button>`).join('');
  ($('calRefresh') as HTMLButtonElement).disabled = loading;
  $('calRefresh').textContent = loading ? 'Reading…' : 'Refresh';
  const note = msg || (failed ? 'Couldn’t reach the PC. Trying again…' : viaConnector ? 'From your claude.ai calendar connector.' : '');
  $('calNote').hidden = !note;
  $('calNote').textContent = note;
  const body = view === 'day' ? dayHtml() : view === 'week' ? weekHtml() : view === 'month' ? monthHtml() : yearHtml();
  $('calBody').innerHTML = loading && !events.length ? '<p class="cal-none">Reading the calendar…</p>' : body;
}

// ---------- add an event: checked here, then written to the ClaudeOS calendar only after Yes ----------
interface Draft { title: string; date: string; start: string; end: string; allDay: boolean; where: string }
let draft: Draft = { title: '', date: '', start: '09:00', end: '09:30', allDay: false, where: '' };
let addSending = false;

// The same form adds an event, or saves changes to one ClaudeOS event (editingId is its id then).
let editingId: string | null = null;

function setAddMode(editing: boolean): void {
  $('calAddHead').textContent = editing ? 'Edit event' : 'Add an event';
  $('calAddConfirmHead').textContent = editing ? 'Save in ClaudeOS?' : 'Add to ClaudeOS?';
  $('calAddNote').textContent = editing ? 'It is saved in ClaudeOS, not in Google.' : 'It is added to ClaudeOS, not to Google.';
  $('calAddYes').textContent = editing ? 'Yes, save it' : 'Yes, add it';
}

function openAdd(): void {
  draft = { title: '', date: keyOf(anchor), start: '09:00', end: '09:30', allDay: false, where: '' };
  editingId = null;
  setAddMode(false);
  $('calAdd').hidden = false;
  backToForm();
}

function closeAdd(): void { editingId = null; $('calAdd').hidden = true; }

/** The add form's draft for an existing event, so Edit starts from its current values. */
function draftOf(e: Ev): Draft {
  const s = new Date(e.start), t = new Date(e.end);
  const hm = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { title: e.title, date: keyOf(s), start: hm(s), end: e.allDay ? '09:30' : hm(t), allDay: !!e.allDay, where: e.location ?? '' };
}

function renderAdd(note: string): void {
  $('calAddTitleV').textContent = draft.title || 'Tap to type';
  $('calAddDateV').textContent = dayFmt.format(fromKey(draft.date));
  $('calAddAllDayV').textContent = draft.allDay ? 'Yes' : 'No';
  $('calAddStart').hidden = draft.allDay;
  $('calAddEnd').hidden = draft.allDay;
  $('calAddStartV').textContent = draft.start;
  $('calAddEndV').textContent = draft.end;
  $('calAddWhereV').textContent = draft.where || 'Optional';
  $('calAddMsg').hidden = !note;
  $('calAddMsg').textContent = note;
}

/** The name and the place are typed. The day and the times are picked (below). */
function editDraft(field: 'title' | 'where'): void {
  const placeholder = { title: 'Dentist', where: 'Main St' }[field];
  Keyboard.open({ value: draft[field], placeholder, done: 'Done', max: field === 'where' ? 200 : 120,
    onDone: v => { draft[field] = v.trim(); renderAdd(''); } });
}

// ---------- the day and time pickers: ClaudeOS's own sheet, never the Android picker ----------
type PickField = 'date' | 'start' | 'end';
let pickField: PickField | null = null;
let pickMonth = new Date();   // the month the day grid shows
const WEEK_DAYS = Array.from({ length: 7 }, (_, i) => weekdayFmt.format(new Date(2024, 0, 1 + i)));   // Jan 1 2024 is a Monday
const spinner = (unit: 'h' | 'm', value: string): string => {
  const more = unit === 'h' ? 'One hour later' : 'Five minutes later', less = unit === 'h' ? 'One hour earlier' : 'Five minutes earlier';
  return `<div class="cal-pick-spin"><button type="button" data-unit="${unit}" data-d="1" aria-label="${more}">+</button>`
    + `<b>${value}</b><button type="button" data-unit="${unit}" data-d="-1" aria-label="${less}">−</button></div>`;
};

function openPicker(field: PickField): void {
  pickField = field;
  if (field === 'date') pickMonth = fromKey(draft.date);
  paintPicker();
  $('calPick').hidden = false;
}
function closePicker(): void { pickField = null; $('calPick').hidden = true; renderAdd(''); }

function paintPicker(): void {
  const card = $('calPickCard');
  if (pickField === 'date') {
    const cells = monthWeeks(pickMonth.getFullYear(), pickMonth.getMonth()).flat().map(k => k
      ? `<button type="button" class="cal-pick-day${k === draft.date ? ' on' : ''}" data-key="${k}">${+k.slice(8)}</button>`
      : '<span></span>').join('');
    card.innerHTML = `<h2>Pick a day</h2>
      <div class="cal-pick-month"><button type="button" class="cal-pick-step" data-step="-1" aria-label="Previous month">‹</button>
      <b>${esc(monthFmt.format(pickMonth))}</b><button type="button" class="cal-pick-step" data-step="1" aria-label="Next month">›</button></div>
      <div class="cal-pick-grid">${WEEK_DAYS.map(w => `<span class="cal-pick-wd">${w}</span>`).join('')}${cells}</div>
      <div class="cal-add-row"><button type="button" class="cal-btn" data-done="1">Close</button></div>`;
  } else {
    const [h, m] = (pickField === 'start' ? draft.start : draft.end).split(':');
    card.innerHTML = `<h2>${pickField === 'start' ? 'Starts' : 'Ends'}</h2>
      <div class="cal-pick-time">${spinner('h', h)}<b class="cal-pick-colon">:</b>${spinner('m', m)}</div>
      <div class="cal-add-row"><button type="button" class="cal-btn cal-btn-primary" data-done="1">Done</button></div>`;
  }
}

/** One step of the time sheet: hours by an hour, minutes by five. Moving the start moves the end with it. */
function pickStep(unit: 'h' | 'm', d: number): void {
  if (pickField !== 'start' && pickField !== 'end') return;
  const by = unit === 'h' ? 60 * d : 5 * d;
  if (pickField === 'start') {
    const before = draft.start;
    draft.start = stepClock(before, by);
    draft.end = shiftEnd(before, draft.start, draft.end);
  } else draft.end = stepClock(draft.end, by);
  paintPicker();
}

/** The draft as a start and an end in ms, or why it is not ready. */
function draftEvent(): { ok: true; start: number; end: number } | { ok: false; error: string } {
  if (!draft.title) return { ok: false, error: 'Tap Name to give the event a name.' };
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft.date);
  if (!d) return { ok: false, error: 'The day should look like 2026-11-24.' };
  const day = new Date(+d[1], +d[2] - 1, +d[3]);
  if (draft.allDay) return { ok: true, start: day.getTime(), end: addDays(day, 1).getTime() };
  const s = /^(\d{1,2}):(\d{2})$/.exec(draft.start), e = /^(\d{1,2}):(\d{2})$/.exec(draft.end);
  const clock = (m: RegExpExecArray | null): boolean => !!m && +m[1] < 24 && +m[2] < 60;
  if (!clock(s) || !clock(e)) return { ok: false, error: 'The times should look like 09:00.' };
  const at = (m: RegExpExecArray): number => new Date(day.getFullYear(), day.getMonth(), day.getDate(), +m[1], +m[2]).getTime();
  const start = at(s!), end = at(e!);
  if (end <= start) return { ok: false, error: 'The end must be after the start. Tap Ends to pick a later time.' };
  return { ok: true, start, end };
}

function review(): void {
  const r = draftEvent();
  if (!r.ok) { renderAdd(r.error); return; }
  const day = dayFmt.format(fromKey(draft.date));
  const when = draft.allDay ? `all day on ${day}` : `${day}, ${timeFmt.format(new Date(r.start))} to ${timeFmt.format(new Date(r.end))}`;
  $('calAddSummary').textContent = `“${draft.title}”, ${when}${draft.where ? `, at ${draft.where}` : ''}.`;
  $('calAddForm').hidden = true;
  $('calAddConfirm').hidden = false;
}

function backToForm(): void {
  $('calAddForm').hidden = false;
  $('calAddConfirm').hidden = true;
  renderAdd('');
}

/** Writes the event to the ClaudeOS calendar on the PC, only after Yes: a new event (local-add) or the changes to one (local-update). The PC checks it again. */
async function addEvent(): Promise<void> {
  if (addSending) return;
  const r = draftEvent();
  if (!r.ok) { backToForm(); renderAdd(r.error); return; }
  addSending = true;
  const id = editingId;
  const body = { title: draft.title, start: r.start, end: r.end, allDay: draft.allDay, location: draft.where };
  let answer: { status?: string; event?: unknown; error?: string } | null = null;
  try {
    answer = id
      ? await postJson<{ status?: string; event?: unknown; error?: string }>(`${API}/local-update`, { id, ...body })
      : await postJson<{ status?: string; event?: unknown; error?: string }>(`${API}/local-add`, body);
  } catch { answer = null; }
  addSending = false;
  if (answer?.status === 'ok') {
    closeAdd();
    await load();   // the range again, so the new event is drawn at once
    msg = id ? `Saved “${draft.title}” in ClaudeOS.` : `Added “${draft.title}” to ClaudeOS.`;
    render();
  } else {
    backToForm();
    renderAdd(answer?.error ?? 'Couldn’t save it. Try again in a moment.');
  }
}

// ---------- an event's details: Edit and Delete, only for a ClaudeOS event (edit.ts) ----------
function openDetail(id: string): void {
  const e = events.find(x => x.id === id);
  if (!e || !ownEvent(e)) return;
  detailId = id;
  deleteArmed = false;
  detailErr = '';
  paintDetail();
  $('calDetail').hidden = false;
}

function closeDetail(): void {
  detailId = null;
  deleteArmed = false;
  detailErr = '';
  $('calDetail').hidden = true;
}

function paintDetail(): void {
  const e = events.find(x => x.id === detailId);
  if (!e) { closeDetail(); return; }
  const day = dayFmt.format(new Date(e.start));
  $('calDetailTitle').textContent = e.title;
  $('calDetailWhen').textContent = e.allDay ? `All day on ${day}` : `${day}, ${timeFmt.format(new Date(e.start))} to ${timeFmt.format(new Date(e.end))}`;
  $('calDetailWhere').hidden = !e.location;
  $('calDetailWhere').textContent = e.location ?? '';
  const canEdit = formCanShow(e);
  $('calDetailNote').hidden = canEdit;
  $('calDetailEdit').hidden = !canEdit;
  const del = $('calDetailDelete');
  del.textContent = deleteArmed ? 'Tap again to delete' : 'Delete';
  del.classList.toggle('armed', deleteArmed);
  const warn = deleteArmed ? 'This removes the event from ClaudeOS. It can’t be undone.' : '';
  $('calDetailMsg').hidden = !(warn || detailErr);
  $('calDetailMsg').textContent = detailErr || warn;
}

/** Edit: the add form, filled with the event. Review and Yes save it through local-update. */
function openEdit(): void {
  const e = events.find(x => x.id === detailId);
  if (!e || !e.id || !editable(e)) return;
  draft = draftOf(e);
  editingId = e.id;
  closeDetail();
  setAddMode(true);
  $('calAdd').hidden = false;
  backToForm();
}

/** Delete: the first tap asks again, the second removes the event (local-delete) and reloads the range. */
async function deleteDetail(): Promise<void> {
  const e = events.find(x => x.id === detailId);
  if (!e || !e.id || addSending) return;
  if (!deleteArmed) { deleteArmed = true; detailErr = ''; paintDetail(); return; }
  addSending = true;
  let answer: { status?: string; error?: string } | null = null;
  try { answer = await postJson<{ status?: string; error?: string }>(`${API}/local-delete`, { id: e.id }); } catch { answer = null; }
  addSending = false;
  if (answer?.status === 'ok') {
    closeDetail();
    await load();
    msg = `Deleted “${e.title}” from ClaudeOS.`;
    render();
  } else {
    deleteArmed = false;
    detailErr = answer?.error ?? 'Couldn’t delete it. Try again in a moment.';
    paintDetail();
  }
}

// ---------- settings (Settings > Apps > Calendar) ----------
function settingRows(): SettingRow[] {
  const s = status;
  const unreachable = !s && statusFailed;   // no answer from the PC: the address may be saved there
  const rows: SettingRow[] = [
    { kind: 'action', id: 'address', title: 'Calendar address',
      detail: msg || (unreachable ? 'The address shows when the PC is back.' : 'Your calendar’s secret address in iCal format (it ends in .ics). Kept only on the PC; ClaudeOS only reads the calendar.'),
      value: () => (unreachable ? 'Can’t reach the PC' : s?.configured ? s.address : 'Not set'), label: s?.configured ? 'Replace' : 'Add', run: editAddress },
  ];
  if (!s?.configured && !unreachable) {
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

// ---------- starts-soon notices: checked in the background once an ICS address is set (no connector read) ----------
// The events come from the PC's ICS read, so the check runs while the calendar app is closed. A notice goes through
// alertFor (system.ts), which keeps Do Not Disturb, focus modes, quiet hours and muted apps. The told events are kept
// in local storage, so a reload does not tell them again (event-notice.ts).
// With the PC off, the tablet checks its copy of the events (cal.events, kept each time the PC answers, with the time
// the PC read the calendar). The copy is used only while it is at most COPY_MAX_MS old. The told set is never reset.
const NOTICED_KEY = 'cal.noticed';
const EVENTS_KEY = 'cal.events';
const NOTICE_CHECK_MS = 60e3;
const readNotified = (): Notified => { try { return JSON.parse(store.get(NOTICED_KEY) || '{}') as Notified; } catch { return {}; } };

/** The events to check: the PC's now (kept as the tablet copy), else the copy when it is recent enough, else none. */
async function soonEvents(now: number): Promise<{ events: CalEvent[]; copyTime?: string } | null> {
  let r: CalEvents | null = null;
  try { r = await getJson<CalEvents>(`${API}/events`); } catch { r = null; }   // the PC cannot be reached
  if (r) {
    if (r.status === 'not_set' && caps.localState) store.set(EVENTS_KEY, null);   // the address was removed: forget the copy
    const answer = pcAnswer(r.status);
    if (answer === 'none') return null;                                      // not set up
    if (answer === 'use' && caps.localState) {
      const next: EventCopy = { readAt: Date.parse(r.fetchedAt ?? '') || now, events: r.events };
      const json = JSON.stringify(next);
      if (json !== store.get(EVENTS_KEY)) store.set(EVENTS_KEY, json);
    }
    if (answer === 'use') return { events: r.events };
  }
  // the PC could not answer with events: the tablet's copy, when it is recent enough
  const copy = caps.localState ? parseCopy(store.get(EVENTS_KEY)) : null;
  if (!copy || !copyUsable(copy.readAt, now)) return null;
  return { events: copy.events, copyTime: timeFmt.format(new Date(copy.readAt)) };
}

async function checkSoon(): Promise<void> {
  const now = Date.now();
  const got = await soonEvents(now);
  if (!got) return;   // nothing to tell; the told set in local storage is left as it is
  const told = pruneNotified(readNotified(), now);
  for (const e of dueNotices(got.events, now, told)) {
    const start = Date.parse(e.start);
    told[eventKey(e)] = start;
    store.set(NOTICED_KEY, JSON.stringify(told));   // saved before the notice, so a reload never repeats it
    const { title, body } = noticeText(e, timeFmt.format(new Date(start)), got.copyTime);
    alertFor('event', { title, body, app: manifest.id }, undefined, ctx ? ctx.isVisible() : false);
  }
  store.set(NOTICED_KEY, JSON.stringify(told));
}
setTimeout(() => void checkSoon(), 5e3);
setInterval(() => void checkSoon(), NOTICE_CHECK_MS);

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
    $('calCals').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cal]');
      if (b?.dataset.cal) void toggleCal(b.dataset.cal);
    });
    $('calAddBtn').addEventListener('click', openAdd);
    $('calAddCancel').addEventListener('click', closeAdd);
    $('calAddTitle').addEventListener('click', () => editDraft('title'));
    $('calAddDate').addEventListener('click', () => openPicker('date'));
    $('calAddAllDay').addEventListener('click', () => { draft.allDay = !draft.allDay; renderAdd(''); });
    $('calAddStart').addEventListener('click', () => openPicker('start'));
    $('calAddEnd').addEventListener('click', () => openPicker('end'));
    $('calPick').addEventListener('click', e => { if (e.target === $('calPick')) closePicker(); });
    // Back (system.ts): an open day or time picker closes first; otherwise Back goes on to Home
    onBack(() => {
      if (!$('calDetail').hidden) { closeDetail(); return true; }
      if ($('calPick').hidden) return false;
      closePicker();
      return true;
    });
    $('calDetailClose').addEventListener('click', closeDetail);
    $('calDetailEdit').addEventListener('click', openEdit);
    $('calDetailDelete').addEventListener('click', () => void deleteDetail());
    $('calPickCard').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.step) { pickMonth = new Date(pickMonth.getFullYear(), pickMonth.getMonth() + +b.dataset.step, 1); paintPicker(); }
      else if (b.dataset.key) { draft.date = b.dataset.key; closePicker(); }
      else if (b.dataset.unit) pickStep(b.dataset.unit as 'h' | 'm', +b.dataset.d!);
      else if (b.dataset.done) closePicker();
    });
    $('calAddWhere').addEventListener('click', () => editDraft('where'));
    $('calAddReview').addEventListener('click', review);
    $('calAddNo').addEventListener('click', backToForm);
    $('calAddYes').addEventListener('click', () => void addEvent());
    for (const v of ['day', 'week', 'month', 'year'] as View[]) $(`calV-${v}`).addEventListener('click', () => setView(v));
    // a ClaudeOS event opens its details; a day, a week's header, a month cell, or a month name in the Year view
    $('calBody').addEventListener('click', e => {
      const t = e.target as HTMLElement;
      const own = t.closest<HTMLElement>('[data-ev]');
      if (own?.dataset.ev) { openDetail(own.dataset.ev); return; }
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
