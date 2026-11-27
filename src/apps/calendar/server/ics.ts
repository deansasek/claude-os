// A small iCalendar (ICS) reader: just enough to list today's and tomorrow's events.
//
//   - VEVENTs only (VTIMEZONE, VALARM, VTODO... are skipped); folded lines are unfolded; text is unescaped.
//   - DTSTART / DTEND as a date (all-day) or a date-time. "Z" times are UTC; a TZID is converted from its zone (IANA or common Windows names), and no zone at all is read as
//     the PC's local time (the family's calendar is in the family's time zone). No DTEND: DURATION, else one day for
//     an all-day event and no length for a timed one.
//   - RRULE: FREQ DAILY, WEEKLY (BYDAY), MONTHLY (BYMONTHDAY, or BYDAY such as 2TU / -1FR, narrowed by BYSETPOS such as -1) and YEARLY, with
//     INTERVAL, COUNT and UNTIL. EXDATE removes an occurrence; an event with a RECURRENCE-ID replaces one.
//   - STATUS:CANCELLED events are left out.
// Anything it doesn't understand is skipped, never a crash.

interface Stamp { y: number; mo: number; d: number; h: number; mi: number; s: number; utc: boolean; date: boolean; tz?: string }   // tz: the IANA zone of a TZID time

export interface RawEvent {
  uid: string;
  title: string;
  location?: string;
  start: Stamp;
  end?: Stamp;
  durMs?: number;
  rrule?: Record<string, string>;
  exdates: number[];
  recurrenceId?: number;
  cancelled: boolean;
}

/** One occurrence, in ms. */
export interface Occurrence { title: string; location?: string; start: number; end: number; allDay: boolean }

const MAX_EVENTS = 20000;
const MAX_STEPS = 20000;
const DAY_MS = 864e5;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// ---------- lines ----------
function unfold(text: string): string[] {
  return text.replace(/^﻿/, '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  let q = false, i = 0;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === ':' && !q) break;
  }
  if (i >= line.length) return null;
  const parts = line.slice(0, i).split(';');
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const k = p.indexOf('=');
    if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value: line.slice(i + 1) };
}

const unescapeText = (v: string, max = 200): string =>
  v.replace(/\\([\\;,nN])/g, (_m, c: string) => (c === 'n' || c === 'N' ? ' ' : c))
    .replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------- dates ----------
// Outlook writes Windows zone names. The common ones map to IANA zones; anything else is read as the PC's local time.
const WINDOWS_ZONES: Record<string, string> = {
  'GMT Standard Time': 'Europe/London', 'W. Europe Standard Time': 'Europe/Berlin', 'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw', 'GTB Standard Time': 'Europe/Bucharest', 'E. Europe Standard Time': 'Europe/Bucharest',
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles', 'Alaskan Standard Time': 'America/Anchorage', 'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax', 'E. Australia Standard Time': 'Australia/Brisbane', 'AUS Eastern Standard Time': 'Australia/Sydney',
  'China Standard Time': 'Asia/Shanghai', 'Tokyo Standard Time': 'Asia/Tokyo', 'India Standard Time': 'Asia/Kolkata', 'UTC': 'UTC',
};

/** The IANA zone for a TZID (IANA or Windows name), or null if the runtime doesn't know it. */
function ianaZone(tzid: string): string | null {
  const name = WINDOWS_ZONES[tzid.trim()] ?? tzid.trim();
  try { new Intl.DateTimeFormat('en-US', { timeZone: name }); return name; } catch { return null; }
}

/** How far a zone is ahead of UTC at a moment, in ms (east is positive). */
function offsetMs(ms: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => +(parts.find(p => p.type === t)?.value ?? 0);
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wallAsUtc - Math.floor(ms / 1000) * 1000;
}

/** A wall-clock time in its zone, as UTC ms. Two passes settle the hour either side of a clock change. */
function wallToUtc(t: Stamp): number {
  const wall = Date.UTC(t.y, t.mo, t.d, t.h, t.mi, t.s);
  const first = wall - offsetMs(wall, t.tz!);
  return wall - offsetMs(first, t.tz!);
}
function parseStamp(v: string, params: Record<string, string> = {}): Stamp | null {
  const m = v.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i);
  if (!m) return null;
  const date = !m[4] || params.VALUE === 'DATE';
  const st: Stamp = { y: +m[1], mo: +m[2] - 1, d: +m[3], h: date ? 0 : +m[4], mi: date ? 0 : +m[5], s: date ? 0 : +(m[6] ?? 0), utc: !date && !!m[7], date };
  if (!st.utc && !st.date && params.TZID) { const tz = ianaZone(params.TZID); if (tz) st.tz = tz; }
  return st.mo >= 0 && st.mo < 12 && st.d >= 1 && st.d <= 31 && st.h < 24 && st.mi < 60 && st.s < 61 ? st : null;
}

const toMs = (t: Stamp): number => (t.utc ? Date.UTC(t.y, t.mo, t.d, t.h, t.mi, t.s) : t.tz ? wallToUtc(t) : new Date(t.y, t.mo, t.d, t.h, t.mi, t.s).getTime());
const dayNum = (t: Stamp): number => Math.floor(Date.UTC(t.y, t.mo, t.d) / DAY_MS);
const dow = (t: Stamp): number => new Date(Date.UTC(t.y, t.mo, t.d)).getUTCDay();
const daysIn = (y: number, mo: number): number => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
function addDays(t: Stamp, n: number): Stamp {
  const x = new Date(Date.UTC(t.y, t.mo, t.d + n));
  return { ...t, y: x.getUTCFullYear(), mo: x.getUTCMonth(), d: x.getUTCDate() };
}
const onDay = (t: Stamp, y: number, mo: number, d: number): Stamp => ({ ...t, y, mo, d });

/** "P1D", "PT1H30M", "P1W", "-PT15M" → ms (null when it isn't one). */
function parseDuration(v: string): number | null {
  const m = v.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const ms = (((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 24 + +(m[4] ?? 0)) * 60 + +(m[5] ?? 0)) * 60e3 + +(m[6] ?? 0) * 1e3;
  return m[1] === '-' ? -ms : ms;
}

// ---------- the file ----------
export function parseIcs(text: string): RawEvent[] {
  const out: RawEvent[] = [];
  let cur: Partial<RawEvent> & { exdates: number[] } | null = null;
  let depth = 0;   // components nested inside the VEVENT (VALARM...): their lines are skipped
  for (const line of unfold(text)) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      const what = p.value.trim().toUpperCase();
      if (cur) depth++;
      else if (what === 'VEVENT') { cur = { exdates: [], cancelled: false }; depth = 0; }
      continue;
    }
    if (p.name === 'END') {
      if (!cur) continue;
      if (depth > 0) { depth--; continue; }
      if (p.value.trim().toUpperCase() === 'VEVENT') {
        if (cur.start && out.length < MAX_EVENTS) {
          out.push({ uid: cur.uid ?? `noid${out.length}`, title: cur.title || '(No title)', start: cur.start, exdates: cur.exdates, cancelled: !!cur.cancelled,
            ...(cur.location ? { location: cur.location } : {}), ...(cur.end ? { end: cur.end } : {}), ...(cur.durMs != null ? { durMs: cur.durMs } : {}),
            ...(cur.rrule ? { rrule: cur.rrule } : {}), ...(cur.recurrenceId != null ? { recurrenceId: cur.recurrenceId } : {}) });
        }
        cur = null;
      }
      continue;
    }
    if (!cur || depth > 0) continue;
    switch (p.name) {
      case 'UID': cur.uid = p.value.trim().slice(0, 300); break;
      case 'SUMMARY': cur.title = unescapeText(p.value); break;
      case 'LOCATION': { const l = unescapeText(p.value, 120); if (l) cur.location = l; break; }
      case 'DTSTART': cur.start = parseStamp(p.value, p.params) ?? undefined; break;
      case 'DTEND': cur.end = parseStamp(p.value, p.params) ?? undefined; break;
      case 'DURATION': { const d = parseDuration(p.value); if (d != null && d >= 0) cur.durMs = d; break; }
      case 'STATUS': cur.cancelled = p.value.trim().toUpperCase() === 'CANCELLED'; break;
      case 'RRULE': {
        const r: Record<string, string> = {};
        for (const kv of p.value.split(';')) { const k = kv.indexOf('='); if (k > 0) r[kv.slice(0, k).toUpperCase()] = kv.slice(k + 1).toUpperCase(); }
        if (r.FREQ) cur.rrule = r;
        break;
      }
      case 'EXDATE':
        for (const v of p.value.split(',')) { const t = parseStamp(v, p.params); if (t) cur.exdates.push(toMs(t)); }
        break;
      case 'RECURRENCE-ID': { const t = parseStamp(p.value, p.params); if (t) cur.recurrenceId = toMs(t); break; }
    }
  }
  return out;
}

// ---------- repeats ----------
function untilMs(v: string): number {
  const t = parseStamp(v);
  if (!t) return Infinity;
  return t.date ? new Date(t.y, t.mo, t.d + 1).getTime() - 1 : toMs(t);
}

/** The candidate days of one period (in order), before COUNT / UNTIL / the start are applied; null when the rule isn't understood. */
function period(s: Stamp, r: Record<string, string>, k: number, interval: number): { first: Stamp; days: Stamp[] } | null {
  const byday = (r.BYDAY ?? '').split(',').map(x => x.trim()).filter(Boolean);
  const plainDays = byday.map(x => WEEKDAYS.indexOf(x.slice(-2))).filter(i => i >= 0);
  switch (r.FREQ) {
    case 'DAILY': {
      const c = addDays(s, k * interval);
      return { first: c, days: plainDays.length && !plainDays.includes(dow(c)) ? [] : [c] };
    }
    case 'WEEKLY': {
      const monday = addDays(s, -((dow(s) + 6) % 7) + 7 * interval * k);
      const offs = (plainDays.length ? plainDays : [dow(s)]).map(i => (i + 6) % 7);
      return { first: monday, days: [...new Set(offs)].sort((a, b) => a - b).map(o => addDays(monday, o)) };
    }
    case 'MONTHLY': {
      const mAll = s.mo + k * interval, y = s.y + Math.floor(mAll / 12), mo = ((mAll % 12) + 12) % 12, n = daysIn(y, mo);
      const first = onDay(s, y, mo, 1);
      const days = new Set<number>();
      if (byday.length) {
        for (const b of byday) {
          const m = b.match(/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/);
          if (!m) continue;
          const wd = WEEKDAYS.indexOf(m[2]);
          const all: number[] = [];
          for (let d = 1; d <= n; d++) if (new Date(Date.UTC(y, mo, d)).getUTCDay() === wd) all.push(d);
          if (!m[1]) all.forEach(d => days.add(d));
          else { const i = +m[1]; const d = i > 0 ? all[i - 1] : all[all.length + i]; if (d) days.add(d); }
        }
      } else {
        const md = (r.BYMONTHDAY ?? '').split(',').map(Number).filter(x => Number.isInteger(x) && x !== 0);
        for (const x of md.length ? md : [s.d]) { const d = x > 0 ? x : n + 1 + x; if (d >= 1 && d <= n) days.add(d); }
      }
      const sorted = [...days].sort((a, b) => a - b);
      // BYSETPOS picks positions from the month's list: 1 is the first, -1 the last. Values that are not integers are ignored.
      const sets = (r.BYSETPOS ?? '').split(',').map(x => x.trim()).filter(x => /^[+-]?\d+$/.test(x)).map(Number).filter(x => x !== 0 && x >= -366 && x <= 366);
      if (!sets.length) return { first, days: sorted.map(d => onDay(s, y, mo, d)) };
      const picked = new Set<number>();
      for (const p of sets) { const i = p > 0 ? p - 1 : sorted.length + p; if (i >= 0 && i < sorted.length) picked.add(sorted[i]); }
      return { first, days: [...picked].sort((a, b) => a - b).map(d => onDay(s, y, mo, d)) };
    }
    case 'YEARLY': {
      const y = s.y + k * interval;
      // BYMONTH and BYDAY ("the second Sunday of May"): the month's days, worked out as a monthly rule for that month
      if (r.BYMONTH || byday.length) {
        // every month in BYMONTH (1 to 12, sorted, no repeats); with no valid month, the yearly date below
        const months = r.BYMONTH
          ? [...new Set(r.BYMONTH.split(',').map(Number).filter(x => Number.isInteger(x) && x >= 1 && x <= 12))].map(x => x - 1).sort((a, b) => a - b)
          : [s.mo];
        if (months.length) {
          const parts = months.map(mo => period(s, { ...r, FREQ: 'MONTHLY' }, (y - s.y) * 12 + (mo - s.mo), 1)).filter(p => p !== null);
          return { first: parts[0].first, days: parts.flatMap(p => p.days) };
        }
      }
      return { first: onDay(s, y, 0, 1), days: s.d <= daysIn(y, s.mo) ? [onDay(s, y, s.mo, s.d)] : [] };
    }
    default: return null;
  }
}

/** The start of every occurrence of `e` that begins before `to` (in order), with COUNT and UNTIL applied. */
function starts(e: RawEvent, from: number, to: number): Stamp[] {
  const s = e.start, r = e.rrule;
  if (!r) return toMs(s) < to ? [s] : [];
  const interval = Math.max(1, Math.min(1000, parseInt(r.INTERVAL ?? '1', 10) || 1));
  const count = r.COUNT ? Math.max(0, parseInt(r.COUNT, 10) || 0) : Infinity;
  const until = r.UNTIL ? untilMs(r.UNTIL) : Infinity;
  const startMs = toMs(s);
  const out: Stamp[] = [];
  // without COUNT, a daily or weekly rule can skip straight to the periods near `from`
  let k = 0;
  if (count === Infinity && (r.FREQ === 'DAILY' || r.FREQ === 'WEEKLY')) {
    const span = interval * (r.FREQ === 'DAILY' ? 1 : 7);
    k = Math.max(0, Math.floor((Math.floor(from / DAY_MS) - dayNum(s)) / span) - 2);
  }
  let n = 0;
  for (let steps = 0; steps < MAX_STEPS; steps++, k++) {
    const p = period(s, r, k, interval);
    if (!p) return toMs(s) < to ? [s] : [];   // a rule it doesn't know: just the first one
    if (toMs(p.first) >= to && dayNum(p.first) > dayNum(s)) break;
    for (const c of p.days) {
      const ms = toMs(c);
      if (ms < startMs) continue;
      if (ms > until || ++n > count || ms >= to) return out;
      out.push(c);
    }
  }
  return out;
}

/** Every occurrence that overlaps [from, to), each in ms. */
export function occurrences(events: RawEvent[], from: number, to: number): Occurrence[] {
  const moved = new Set(events.filter(e => e.recurrenceId != null).map(e => `${e.uid}|${e.recurrenceId}`));
  const out: Occurrence[] = [];
  for (const e of events) {
    if (e.cancelled && e.recurrenceId == null) continue;
    const allDay = e.start.date;
    const lenDays = allDay ? (e.end ? Math.max(1, dayNum(e.end) - dayNum(e.start)) : e.durMs != null ? Math.max(1, Math.round(e.durMs / DAY_MS)) : 1) : 0;
    const lenMs = allDay ? 0 : e.end ? Math.max(0, toMs(e.end) - toMs(e.start)) : e.durMs ?? 0;
    const isOverride = e.recurrenceId != null;
    for (const st of isOverride ? [e.start] : starts(e, from, to)) {
      const start = toMs(st);
      if (!isOverride && e.rrule && (e.exdates.includes(start) || moved.has(`${e.uid}|${start}`))) continue;
      if (e.cancelled) continue;
      const end = allDay ? toMs(addDays(st, lenDays)) : start + lenMs;
      if (start < to && (end > from || (end === start && start >= from))) out.push({ title: e.title, start, end, allDay, ...(e.location ? { location: e.location } : {}) });
    }
  }
  return out;
}
