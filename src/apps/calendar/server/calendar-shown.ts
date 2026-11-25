// The shown or hidden flag of each calendar, kept on the PC in calendar-shown.json (outside src/, git-ignored).
// Only the known ids are stored, and only as true or false. A missing or unreadable file means every calendar is shown.
import path from 'node:path';
import { STATE, readJson, writeJsonFile } from '../../../core/server/paths.ts';
import { CAL_IDS, calendarsFor, cleanFlags, type CalendarInfo, type ShownFlags } from '../web/calendars.ts';

// CLAUDEOS_CALENDAR_SHOWN_FILE is for the tests only: a scratch file instead of the real one.
export const FILE = process.env.CLAUDEOS_CALENDAR_SHOWN_FILE || path.join(STATE, 'calendar-shown.json');

export function loadFlags(): ShownFlags {
  return cleanFlags(readJson<unknown>(FILE));
}

export type ShownResult = { status: 'ok'; calendars: CalendarInfo[] } | { status: 'error'; error: string };

/** Store one calendar's flag and answer the whole list. `hasAddress` says which external calendar is listed. */
export function setShown(id: unknown, shown: unknown, hasAddress: boolean): ShownResult {
  if (typeof id !== 'string' || !(CAL_IDS as readonly string[]).includes(id)) return { status: 'error', error: 'That calendar isn’t one ClaudeOS knows.' };
  if (typeof shown !== 'boolean') return { status: 'error', error: 'Say whether the calendar is shown.' };
  const flags = loadFlags();
  flags[id as keyof ShownFlags] = shown;
  try {
    writeJsonFile(FILE, flags, { indent: 2, mode: 0o600 });
  } catch (e) {
    console.log('calendar: could not save the shown calendars:', (e as NodeJS.ErrnoException).code ?? 'error');
    return { status: 'error', error: 'The PC couldn’t save that.' };
  }
  return { status: 'ok', calendars: calendarsFor(hasAddress, flags) };
}
