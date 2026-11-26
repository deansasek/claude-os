// The words on Home's Today (calendar) tile, kept free of the DOM so a test can read them (src/apps/home/web/index.ts).
// The tile is narrow: the value is the next event, and the detail sits under it.

export interface RowEvent { title: string; start: string; end: string; allDay: boolean; day: 'today' | 'tomorrow'; location?: string }
export interface RowCal { status: 'ok' | 'not_set' | 'error' | string; events: RowEvent[]; stale?: boolean }

export interface CalRow { cls: string; val: string; sub: string }

const hmFmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
/** "9:30 AM" for a time, built from parts as Home's clock does. */
function hm(d: Date): string {
  let hour = '', minute = '', period = '';
  for (const p of hmFmt.formatToParts(d)) {
    if (p.type === 'hour') hour = p.value; else if (p.type === 'minute') minute = p.value; else if (p.type === 'dayPeriod') period = p.value;
  }
  return `${hour}:${minute}${period ? ' ' + period : ''}`;
}
const calLine = (e: RowEvent): string => (e.allDay ? `${e.title} (all day)` : `${hm(new Date(e.start))} ${e.title}`);

/**
 * The tile's class, value and detail.
 * Events: the next three still to come today ("9:30 AM Standup", detail "10:00 AM Review · …").
 * No events: "Nothing more" / "A free day", with tomorrow's first event under it.
 * Without events, a failed read wins over a miss: "Can’t read it" + "Can’t reach the PC".
 * A miss (nothing cached yet): "Not read yet" + "Open Calendar to read it".
 * When the last read failed and events were read before, the detail starts with "Offline · ",
 * so old events never look current. When the PC sends its last good copy (stale), the detail
 * starts with "May be out of date · " instead.
 */
export function calendarRow(cal: RowCal | null, failed: boolean, miss: boolean, now: number): CalRow {
  if (!cal || cal.status !== 'ok') {
    if (miss && !failed) return { cls: 'quiet', val: 'Not read yet', sub: 'Open Calendar to read it' };
    return {
      cls: 'quiet',
      val: cal?.status === 'not_set' ? 'No calendar' : failed || cal?.status === 'error' ? 'Can’t read it' : '–',
      sub: cal?.status === 'not_set' ? 'Tap to add yours' : failed ? 'Can’t reach the PC' : cal?.status === 'error' ? 'Tap to see why' : 'Reading the calendar…',
    };
  }
  const off = failed ? 'Offline · ' : cal.stale ? 'May be out of date · ' : '';
  const next = cal.events.filter(e => e.day === 'today' && Date.parse(e.end) > now).slice(0, 3);
  if (!next.length) {
    const tmr = cal.events.find(e => e.day === 'tomorrow');
    return {
      cls: 'quiet',
      val: cal.events.some(e => e.day === 'today') ? 'Nothing more' : 'A free day',
      sub: off + (tmr ? `Tomorrow: ${calLine(tmr)}` : 'Nothing tomorrow either'),
    };
  }
  const rest = next.slice(1).map(calLine).join(' · ');
  return { cls: 'hm-ntitle', val: calLine(next[0]), sub: off + (rest || (next[0].location ?? 'Nothing else today')) };
}

// The connector's answer for one day, as the PC's cached-only read returns it (times as epoch ms).
export interface ConnAnswer { status: string; events?: { title: string; start: number; end: number; allDay: boolean }[] }
export interface ConnRead { cal: RowCal | null; miss: boolean; failed: boolean; day: string | null }

/**
 * What Home keeps after a cached-only connector read (no calendar address set).
 * A miss keeps the earlier events, marked stale, only when they were read on the same local day (todayKey).
 * Otherwise a miss leaves nothing, so the tile says "Not read yet". An ok answer replaces the events and
 * records todayKey as the day read. Any other answer is a failed read. Pure: the caller passes the day.
 */
export function connectorCalAfterRead(
  prev: RowCal | null, prevDay: string | null, today: ConnAnswer, tomorrow: ConnAnswer, todayKey: string,
): ConnRead {
  if (today.status === 'miss' || tomorrow.status === 'miss') {
    if (prev && prev.status === 'ok' && prevDay === todayKey) return { cal: { ...prev, stale: true }, miss: false, failed: false, day: prevDay };
    return { cal: null, miss: true, failed: false, day: null };
  }
  if (today.status !== 'ok' || tomorrow.status !== 'ok' || !today.events || !tomorrow.events) return { cal: null, miss: false, failed: true, day: null };
  const toEv = (day: 'today' | 'tomorrow') => (e: { title: string; start: number; end: number; allDay: boolean }): RowEvent =>
    ({ title: e.title, start: new Date(e.start).toISOString(), end: new Date(e.end).toISOString(), allDay: e.allDay, day });
  const events = [...today.events.map(toEv('today')), ...tomorrow.events.map(toEv('tomorrow'))];
  return { cal: { status: 'ok', events }, miss: false, failed: false, day: todayKey };
}
