// The saved alarm list, checked field by field when the Clock app loads it (index.ts loadAlarms). Pure: no DOM, so Node
// can run it. An entry with a bad hour or minute is left out. A day list keeps only its valid days (0 to 6), and a list
// with no valid day is left out too, so a bad list never turns into an alarm that rings every day.

export interface LoadedAlarm { id: string; h: number; m: number; on: boolean; days: number[]; snooze: number | null; fired: string | null; label?: string; claude?: true }

const LABEL_MAX = 80;
const hourOk = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23;
const minuteOk = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 59;
const dayOk = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6;

/** The alarms in a saved list. newId makes an id for an entry that has none. */
export function readAlarmList(raw: unknown, newId: () => string): LoadedAlarm[] {
  if (!Array.isArray(raw)) return [];
  const out: LoadedAlarm[] = [];
  const seen = new Set<string>();   // an id already used by an earlier alarm is not kept: the Clock app finds alarms by id
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const a = x as Record<string, unknown>;
    if (!hourOk(a.h) || !minuteOk(a.m)) continue;
    const days = Array.isArray(a.days) ? a.days.filter(dayOk) : [];
    if (Array.isArray(a.days) && a.days.length > 0 && days.length === 0) continue;
    const label = typeof a.label === 'string' ? a.label.trim().slice(0, LABEL_MAX) : '';
    const stored = typeof a.id === 'string' && a.id && !seen.has(a.id) ? a.id : null;
    const id = stored ?? newId();
    seen.add(id);
    out.push({
      id,
      h: a.h, m: a.m, on: a.on === true, days,
      snooze: typeof a.snooze === 'number' && Number.isFinite(a.snooze) ? a.snooze : null,
      fired: typeof a.fired === 'string' ? a.fired : null,
      ...(label ? { label } : {}),
      ...(a.claude === true ? { claude: true as const } : {}),
    });
  }
  return out;
}
