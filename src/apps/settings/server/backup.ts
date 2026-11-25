// The settings backup on this PC (Settings → Storage): the tablet's os.* settings and sidebar pins, kept in
// claudeos-settings-backup.json. The keys are filtered here too (web/backup-keys.ts), so a backup never keeps a token,
// a key, the sign-in or the PIN state, whatever the tablet sends.
import path from 'node:path';
import { STATE, readJson, writeJsonFile } from '../../../core/server/paths.ts';
import { backupValues } from '../web/backup-keys.ts';

const FILE = process.env.CLAUDEOS_BACKUP_FILE || path.join(STATE, 'claudeos-settings-backup.json');   // a test sets it
const MAX_KEYS = 200;

interface Saved { saved: string; values: Record<string, string> }

/** The last backup, or nothing when none was saved. */
export function readBackup(): { ok: true; saved: string | null; values: Record<string, string> } {
  const s = readJson<Partial<Saved>>(FILE);
  if (!s || typeof s.saved !== 'string' || !s.values || typeof s.values !== 'object') return { ok: true, saved: null, values: {} };
  return { ok: true, saved: s.saved, values: backupValues(s.values) };
}

/** Keep the tablet's settings. The body is { values: { key: text } }; anything not a backup key is dropped. */
export function saveBackup(body: unknown): { ok: boolean; count?: number; saved?: string; error?: string } {
  const raw = (body as { values?: unknown } | null)?.values;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'That isn’t a settings backup.' };
  const values = backupValues(raw as Record<string, unknown>);
  if (Object.keys(values).length > MAX_KEYS) return { ok: false, error: 'That backup has too many settings.' };
  const saved = new Date().toISOString();
  try {
    writeJsonFile(FILE, { saved, values } satisfies Saved, { indent: 2 });
  } catch (e) {
    console.log('settings: could not save the backup:', e);
    return { ok: false, error: 'The PC couldn’t save the backup.' };
  }
  return { ok: true, count: Object.keys(values).length, saved };
}
