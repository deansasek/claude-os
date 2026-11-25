// The ClaudeOS calendar: events kept on the PC in calendar-local.json (outside src/, so it is never served).
// It needs no account. Only the default calendar, "ClaudeOS", exists for now.
//
// The file is read again for every request and written whole (through a .tmp file). Everything that comes in is
// checked here with new-event.ts: the page and Claude are never trusted. A file that is there but can't be read
// refuses changes, so a bad file is never overwritten.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { STATE, writeJsonFile } from '../../../core/server/paths.ts';
import { checkNewEvent, type NewEvent } from './new-event.ts';

// CLAUDEOS_CALENDAR_LOCAL_FILE is for the tests only: a scratch file instead of the real one.
export const FILE = process.env.CLAUDEOS_CALENDAR_LOCAL_FILE || path.join(STATE, 'calendar-local.json');

export const DEFAULT_CALENDAR = { id: 'claudeos', name: 'ClaudeOS' } as const;
const MAX_EVENTS = 5000;
const ID = /^[a-z0-9]{8,32}$/;

/** One event kept on the PC. start and end are ms since the epoch; end is exclusive. */
export interface LocalEvent extends NewEvent {
  id: string;
  calendar: string;
}

/** What a change answers: the event it made, or how many it removed; or why nothing changed. */
export type LocalResult =
  | { status: 'ok'; event?: LocalEvent; removed?: number }
  | { status: 'error'; error: string };

const UNREADABLE = 'The calendar on the PC couldn’t be read, so nothing was changed.';
type Change = string | { event?: LocalEvent; removed?: number };

/** The events in the file, [] when there is no file yet, null when the file is there but can't be read. */
function load(): LocalEvent[] | null {
  let text: string;
  try { text = fs.readFileSync(FILE, 'utf8'); } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? [] : null;
  }
  try {
    const raw = JSON.parse(text.replace(/^﻿/, '')) as { events?: unknown };
    if (!raw || !Array.isArray(raw.events)) return null;
    const out: LocalEvent[] = [];
    const ids = new Set<string>();
    for (const x of raw.events) {
      if (out.length >= MAX_EVENTS) break;
      const c = storedEvent(x);
      if (c && !ids.has(c.id)) { ids.add(c.id); out.push(c); }
    }
    return out;
  } catch { return null; }
}

/** A stored event, checked again on the way out, or null when it is not one. */
function storedEvent(raw: unknown): LocalEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !ID.test(r.id)) return null;
  const checked = checkNewEvent(r);
  if (!checked.ok) return null;
  return { id: r.id, calendar: DEFAULT_CALENDAR.id, ...checked.event };
}

function persist(events: LocalEvent[]): boolean {
  try {
    writeJsonFile(FILE, { calendars: [DEFAULT_CALENDAR], events }, { indent: 1, mode: 0o600 });
    return true;
  } catch (e) {
    console.log('calendar: could not save the local events:', (e as NodeJS.ErrnoException).code ?? 'error');
    return false;
  }
}

/** Load, change, save. `fn` returns an error (nothing is saved) or the extra fields of a good answer. */
function change(fn: (events: LocalEvent[]) => Change): LocalResult {
  const events = load();
  if (!events) return { status: 'error', error: UNREADABLE };
  const before = JSON.stringify(events);
  const r = fn(events);
  if (typeof r === 'string') return { status: 'error', error: r };
  if (JSON.stringify(events) !== before && !persist(events)) return { status: 'error', error: 'The PC couldn’t save the calendar.' };
  return { status: 'ok', ...r };
}

const sorted = (events: LocalEvent[]): LocalEvent[] => [...events].sort((a, b) => a.start - b.start || a.end - b.end || a.title.localeCompare(b.title));

/** The local events that overlap [from, to) (ms), in order. An event over midnight is listed on each day it touches. */
export function localEventsBetween(from: number, to: number): LocalEvent[] {
  const all = load();
  if (!all) return [];
  return sorted(all).filter(e => e.start < to && (e.end > from || (e.end === e.start && e.start >= from)));
}

/** Add one event. Its id is made here; the page never picks it. */
export function addLocalEvent(input: unknown): LocalResult {
  return change(events => {
    const checked = checkNewEvent(input);
    if (!checked.ok) return checked.error;
    if (events.length >= MAX_EVENTS) return `The calendar is full (${MAX_EVENTS} events). Delete some first.`;
    const event: LocalEvent = { id: randomUUID().replace(/-/g, '').slice(0, 16), calendar: DEFAULT_CALENDAR.id, ...checked.event };
    events.push(event);
    return { event };
  });
}

/** Change one event. The fields not sent keep their values; the result is checked like a new event. */
export function updateLocalEvent(input: unknown): LocalResult {
  return change(events => {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const at = events.findIndex(e => e.id === o.id);
    if (typeof o.id !== 'string' || at < 0) return 'That event isn’t on the calendar. It may have been deleted.';
    const old = events[at];
    const checked = checkNewEvent({
      title: o.title ?? old.title,
      start: o.start ?? old.start,
      end: o.end ?? old.end,
      allDay: o.allDay ?? old.allDay,
      location: o.location ?? old.location,
    });
    if (!checked.ok) return checked.error;
    const event: LocalEvent = { id: old.id, calendar: old.calendar, ...checked.event };
    events[at] = event;
    return { event };
  });
}

/** Delete one event. An event that is already gone is not an error. */
export function deleteLocalEvent(id: unknown): LocalResult {
  return change(events => {
    if (typeof id !== 'string' || !ID.test(id)) return 'That isn’t an event.';
    const at = events.findIndex(e => e.id === id);
    if (at < 0) return { removed: 0 };
    events.splice(at, 1);
    return { removed: 1 };
  });
}
