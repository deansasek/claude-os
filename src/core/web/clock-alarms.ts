// The saved Clock alarms, read for the Home screen, the status line and the lock screen. Each entry is checked field by
// field: an entry that is not an object, or has a bad hour, minute or day list, is left out, so one bad entry hides only
// itself. Pure: it reads the text it is given, so Node can run it. Nothing is saved here.

export interface ReadAlarm { h: number; m: number; on: boolean; days?: number[]; snooze?: number | null; label?: string }

const parse = (raw: string | null): unknown => { try { return JSON.parse(raw || 'null'); } catch { return null; } };
const isHour = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23;
const isMinute = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 59;

function readOne(v: unknown): ReadAlarm | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!isHour(o.h) || !isMinute(o.m)) return null;
  const days = Array.isArray(o.days) && o.days.every(d => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)
    ? (o.days as number[]) : undefined;
  const snooze = typeof o.snooze === 'number' && Number.isFinite(o.snooze) ? o.snooze : null;
  return { h: o.h, m: o.m, on: o.on === true, ...(days ? { days } : {}), snooze, ...(typeof o.label === 'string' ? { label: o.label } : {}) };
}

/** The alarms from the list key, or the old single-alarm key when the list is not an array. Bad entries are left out. */
export function parseClockAlarms(listRaw: string | null, oneRaw: string | null): ReadAlarm[] {
  const list = parse(listRaw);
  if (Array.isArray(list)) return list.map(readOne).filter((a): a is ReadAlarm => a !== null);
  const one = readOne(parse(oneRaw));
  return one ? [one] : [];
}
