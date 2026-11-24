// The calendars the Calendar app can show or hide: ClaudeOS, the ICS address (when set), or the claude.ai connector
// (when no address is set, since the connector then answers). Pure: no DOM and no file access, so Node tests load it.
// The shown flags are kept on the PC (calendar-shown.json, server/calendar-shown.ts). A calendar with no stored flag is shown.

export type CalId = 'claudeos' | 'ics' | 'connector';
export const CAL_IDS: readonly CalId[] = ['claudeos', 'ics', 'connector'];

/** One calendar as the page shows it. colour is a CSS token reference (var(--clay)), never a hex value. */
export interface CalendarInfo { id: CalId; name: string; colour: string; shown: boolean }
export type ShownFlags = Partial<Record<CalId, boolean>>;

/** The calendars for this setup, each with its shown flag. The ICS address and the connector never both appear. */
export function calendarsFor(hasAddress: boolean, flags: ShownFlags): CalendarInfo[] {
  const list: CalendarInfo[] = [{ id: 'claudeos', name: 'ClaudeOS', colour: 'var(--clay)', shown: true }];
  if (hasAddress) list.push({ id: 'ics', name: 'Your calendar', colour: 'var(--olive)', shown: true });
  else list.push({ id: 'connector', name: 'claude.ai calendar', colour: 'var(--t3)', shown: true });
  for (const c of list) c.shown = flags[c.id] !== false;
  return list;
}

/** Only the known ids, and only true or false, from a file that may be missing or edited by hand. */
export function cleanFlags(raw: unknown): ShownFlags {
  const out: ShownFlags = {};
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const id of CAL_IDS) if (typeof r[id] === 'boolean') out[id] = r[id] as boolean;
  return out;
}

/** The shown flags of a calendar list. */
export function flagsOf(list: CalendarInfo[]): ShownFlags {
  const out: ShownFlags = {};
  for (const c of list) out[c.id] = c.shown;
  return out;
}

/** An event is drawn unless its calendar is stored as hidden. An event with no calendar id is drawn. */
export function isShown(flags: ShownFlags, calendar: string | undefined): boolean {
  return !calendar || flags[calendar as CalId] !== false;
}

/** The events that the shown flags leave drawn. */
export function visibleEvents<T extends { calendar?: string }>(events: T[], flags: ShownFlags): T[] {
  return events.filter(e => isShown(flags, e.calendar));
}

/** The same events, each with its calendar id. */
export function tagCalendar<T extends object>(events: T[], calendar: CalId): (T & { calendar: CalId })[] {
  return events.map(e => ({ ...e, calendar }));
}
